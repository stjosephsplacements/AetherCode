package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/aethercode/aethercode/services/judge/internal/dispatcher"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DispatchStoreAdapter implements dispatcher.Store over the judge PostgreSQL
// schema. It is intentionally separate from the control-plane Postgres adapter
// to keep the dispatcher port decoupled from the control-plane app port.
type DispatchStoreAdapter struct {
	pool *pgxpool.Pool
}

// NewDispatchStoreAdapter wraps a connection pool with the dispatcher
// persistence contract.
func NewDispatchStoreAdapter(pool *pgxpool.Pool) *DispatchStoreAdapter {
	return &DispatchStoreAdapter{pool: pool}
}

// FetchQueuedJob returns the job and its non-terminal units. It returns nil
// when the job is not found or has already reached a terminal state, which the
// dispatcher treats as a successful no-op.
func (a *DispatchStoreAdapter) FetchQueuedJob(ctx context.Context, jobID string) (*dispatcher.DispatchJob, error) {
	var languageKey, sourceCiphertextRef string
	var cpuTimeLimitMS int
	var memoryLimitBytes int64
	err := a.pool.QueryRow(ctx, `
		SELECT language_key, cpu_time_limit_ms, memory_limit_bytes, source_ciphertext_ref
		FROM judge.execution_jobs
		WHERE id = $1
		  AND state NOT IN ('completed', 'failed', 'cancelled', 'expired')
	`, jobID).Scan(&languageKey, &cpuTimeLimitMS, &memoryLimitBytes, &sourceCiphertextRef)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("fetch execution job %s: %w", jobID, err)
	}

	rows, err := a.pool.Query(ctx, `
		SELECT id, test_case_ciphertext_ref, COALESCE(judge0_token, '')
		FROM judge.execution_units
		WHERE job_id = $1
		  AND state NOT IN ('completed', 'failed', 'cancelled', 'expired')
		ORDER BY unit_number
	`, jobID)
	if err != nil {
		return nil, fmt.Errorf("fetch execution units for job %s: %w", jobID, err)
	}
	defer rows.Close()

	units := make([]dispatcher.DispatchUnit, 0)
	for rows.Next() {
		var unitID, testCaseRef, token string
		if err := rows.Scan(&unitID, &testCaseRef, &token); err != nil {
			return nil, fmt.Errorf("scan execution unit for job %s: %w", jobID, err)
		}
		units = append(units, dispatcher.DispatchUnit{
			ID:          unitID,
			SourceCode:  sourceCiphertextRef,
			Language:    languageKey,
			Stdin:       testCaseRef,
			TimeLimitMS: cpuTimeLimitMS,
			MemLimitKB:  int(memoryLimitBytes / 1024),
			Token:       token,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate execution units for job %s: %w", jobID, err)
	}

	return &dispatcher.DispatchJob{ID: jobID, Units: units}, nil
}

// RecordToken persists the engine submission token for a test unit and
// advances its state to submitted, enabling crash-recovery polling without
// re-submission.
func (a *DispatchStoreAdapter) RecordToken(ctx context.Context, unitID, token string) error {
	_, err := a.pool.Exec(ctx, `
		UPDATE judge.execution_units
		SET judge0_token = $2, state = 'submitted', updated_at = clock_timestamp()
		WHERE id = $1
	`, unitID, token)
	if err != nil {
		return fmt.Errorf("record engine token for unit %s: %w", unitID, err)
	}
	return nil
}

// RecordVerdict persists the terminal engine verdict for one test unit.
func (a *DispatchStoreAdapter) RecordVerdict(ctx context.Context, unitID string, verdict dispatcher.UnitVerdict) error {
	memoryBytes := int64(verdict.MemoryKB) * 1024
	_, err := a.pool.Exec(ctx, `
		UPDATE judge.execution_units
		SET normalized_verdict = $2,
		    cpu_time_ms        = $3,
		    memory_bytes       = $4,
		    state              = 'completed',
		    terminal_at        = clock_timestamp(),
		    updated_at         = clock_timestamp()
		WHERE id = $1
	`, unitID, verdict.Status, verdict.TimeMS, memoryBytes)
	if err != nil {
		return fmt.Errorf("record verdict for unit %s: %w", unitID, err)
	}
	return nil
}

// MarkJobComplete transitions the job to a terminal state. An overall status
// of "accepted" maps to job state "completed"; any other status maps to
// "failed".
func (a *DispatchStoreAdapter) MarkJobComplete(ctx context.Context, jobID, overallStatus string) error {
	jobState := "failed"
	if overallStatus == "accepted" {
		jobState = "completed"
	}
	_, err := a.pool.Exec(ctx, `
		UPDATE judge.execution_jobs
		SET state       = $2,
		    terminal_at = clock_timestamp(),
		    updated_at  = clock_timestamp()
		WHERE id = $1
	`, jobID, jobState)
	if err != nil {
		return fmt.Errorf("mark job %s complete with state %s: %w", jobID, jobState, err)
	}
	return nil
}

// FetchIncompleteTokens returns all units that have been submitted to the
// engine but have not yet received a verdict. Used for crash-recovery polling
// on worker startup.
func (a *DispatchStoreAdapter) FetchIncompleteTokens(ctx context.Context) ([]dispatcher.PendingUnit, error) {
	rows, err := a.pool.Query(ctx, `
		SELECT id, job_id, judge0_token
		FROM judge.execution_units
		WHERE judge0_token IS NOT NULL
		  AND state IN ('submitted', 'running')
		  AND normalized_verdict IS NULL
	`)
	if err != nil {
		return nil, fmt.Errorf("fetch incomplete tokens: %w", err)
	}
	defer rows.Close()

	pending := make([]dispatcher.PendingUnit, 0)
	for rows.Next() {
		var unit dispatcher.PendingUnit
		if err := rows.Scan(&unit.ID, &unit.JobID, &unit.Token); err != nil {
			return nil, fmt.Errorf("scan incomplete token: %w", err)
		}
		pending = append(pending, unit)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate incomplete tokens: %w", err)
	}
	return pending, nil
}

// unitResultsQuerier is satisfied by both *pgxpool.Pool and pgx.Tx, letting
// fetchUnitResults run inside Postgres.Pull's existing transaction (its only
// caller) without depending on the transaction type directly.
type unitResultsQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// fetchUnitResults returns every completed unit's recorded verdict for a
// job, in unit_number order. Units that have not yet reached state
// 'completed' are excluded: execution_units_result_check guarantees their
// normalized_verdict is NULL, which would otherwise surface as an empty,
// unrecognized verdict string that completionVerdictCode rejects --
// poisoning the whole PullCompletedExecutions batch with codes.Internal for
// one job's stray in-flight unit.
//
// This filter assumes 'completed' is the only reachable terminal state that
// produces a non-NULL verdict. If a future change adds another terminal
// state (e.g. some other terminal status), this WHERE clause must be updated
// too, or results in that state will be silently under-counted here.
func fetchUnitResults(ctx context.Context, querier unitResultsQuerier, jobID string) ([]dispatcher.UnitResult, error) {
	rows, err := querier.Query(ctx, `
		SELECT unit_number, normalized_verdict, cpu_time_ms, memory_bytes
		FROM judge.execution_units
		WHERE job_id = $1
		  AND state = 'completed'
		ORDER BY unit_number
	`, jobID)
	if err != nil {
		return nil, fmt.Errorf("fetch unit results for job %s: %w", jobID, err)
	}
	defer rows.Close()

	results := make([]dispatcher.UnitResult, 0)
	for rows.Next() {
		var unitNumber int
		var verdict *string
		var timeMS *int
		var memoryBytes *int64
		if err := rows.Scan(&unitNumber, &verdict, &timeMS, &memoryBytes); err != nil {
			return nil, fmt.Errorf("scan unit result for job %s: %w", jobID, err)
		}
		result := dispatcher.UnitResult{UnitNumber: unitNumber, TimeMS: timeMS}
		if verdict != nil {
			result.Verdict = *verdict
		}
		if memoryBytes != nil {
			memoryKB := int(*memoryBytes / 1024)
			result.MemoryKB = &memoryKB
		}
		results = append(results, result)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate unit results for job %s: %w", jobID, err)
	}
	return results, nil
}
