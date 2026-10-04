package repo

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/aethercode/aethercode/libs/pkg/kms"
	"github.com/aethercode/aethercode/libs/pkg/storage"
	"github.com/aethercode/aethercode/services/judge/internal/dispatcher"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DispatchStoreAdapter implements dispatcher.Store over the judge PostgreSQL
// schema. It is intentionally separate from the control-plane Postgres adapter
// to keep the dispatcher port decoupled from the control-plane app port.
// storage and kms are required: FetchQueuedJob decrypts the candidate source
// and each test case before they reach the engine.
type DispatchStoreAdapter struct {
	pool    *pgxpool.Pool
	storage storage.Object
	kms     kms.KeyManager
}

// NewDispatchStoreAdapter wraps a connection pool with the dispatcher
// persistence contract.
func NewDispatchStoreAdapter(pool *pgxpool.Pool, objectStorage storage.Object, keyManager kms.KeyManager) *DispatchStoreAdapter {
	return &DispatchStoreAdapter{pool: pool, storage: objectStorage, kms: keyManager}
}

// unitTestCase is the plaintext of a per-unit test-case object, as written by
// evalbundle.MarshalTestCase during fan-out.
type unitTestCase struct {
	Stdin          string `json:"stdin"`
	ExpectedOutput string `json:"expected_output"`
}

// pendingUnit is an execution_units row read before its test case is decrypted.
type pendingUnit struct {
	id, testCaseRef, keyRef, token string
}

// FetchQueuedJob returns the job and its non-terminal units, with the source
// and every not-yet-submitted unit's test case decrypted for the engine. The
// plaintext lives only in the returned value: it is never logged or persisted.
// It returns nil when the job is not found or has already reached a terminal
// state, which the dispatcher treats as a successful no-op.
func (a *DispatchStoreAdapter) FetchQueuedJob(ctx context.Context, jobID string) (*dispatcher.DispatchJob, error) {
	var languageKey, sourceCiphertextRef string
	var sourceKeyRef *string
	var cpuTimeLimitMS int
	var memoryLimitBytes int64
	err := a.pool.QueryRow(ctx, `
		SELECT language_key, cpu_time_limit_ms, memory_limit_bytes, source_ciphertext_ref, source_key_reference
		FROM judge.execution_jobs
		WHERE id = $1
		  AND state NOT IN ('completed', 'failed', 'cancelled', 'expired')
	`, jobID).Scan(&languageKey, &cpuTimeLimitMS, &memoryLimitBytes, &sourceCiphertextRef, &sourceKeyRef)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("fetch execution job %s: %w", jobID, err)
	}
	if sourceKeyRef == nil {
		return nil, fmt.Errorf("execution job %s has no source key reference", jobID)
	}

	rows, err := a.pool.Query(ctx, `
		SELECT id, test_case_ciphertext_ref, encryption_key_reference, COALESCE(judge0_token, '')
		FROM judge.execution_units
		WHERE job_id = $1
		  AND state NOT IN ('completed', 'failed', 'cancelled', 'expired')
		ORDER BY unit_number
	`, jobID)
	if err != nil {
		return nil, fmt.Errorf("fetch execution units for job %s: %w", jobID, err)
	}
	defer rows.Close()

	pending := make([]pendingUnit, 0)
	for rows.Next() {
		var unit pendingUnit
		if err := rows.Scan(&unit.id, &unit.testCaseRef, &unit.keyRef, &unit.token); err != nil {
			return nil, fmt.Errorf("scan execution unit for job %s: %w", jobID, err)
		}
		pending = append(pending, unit)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate execution units for job %s: %w", jobID, err)
	}
	rows.Close()

	source, err := fetchDecrypted(ctx, a.storage, a.kms, sourceCiphertextRef, *sourceKeyRef)
	if err != nil {
		return nil, fmt.Errorf("job %s source: %w", jobID, err)
	}
	units := make([]dispatcher.DispatchUnit, 0, len(pending))
	for _, unit := range pending {
		dispatchUnit := dispatcher.DispatchUnit{
			ID:          unit.id,
			SourceCode:  string(source),
			Language:    languageKey,
			TimeLimitMS: cpuTimeLimitMS,
			MemLimitKB:  int(memoryLimitBytes / 1024),
			Token:       unit.token,
		}
		// A unit that already holds an engine token is only polled, so its
		// test case is not needed again.
		if unit.token == "" {
			plaintext, err := fetchDecrypted(ctx, a.storage, a.kms, unit.testCaseRef, unit.keyRef)
			if err != nil {
				return nil, fmt.Errorf("unit %s test case: %w", unit.id, err)
			}
			var testCase unitTestCase
			if err := json.Unmarshal(plaintext, &testCase); err != nil {
				return nil, fmt.Errorf("unit %s test case: decode: %w", unit.id, err)
			}
			dispatchUnit.Stdin = testCase.Stdin
			dispatchUnit.ExpectedOutput = testCase.ExpectedOutput
		}
		units = append(units, dispatchUnit)
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

// completionRetention is how long a completion stays pullable; it matches the
// 30-day wrapper retention boundary in judge.purge_expired_execution_data.
const completionRetention = 30 * 24 * time.Hour

// MarkJobComplete derives the job's overall verdict from its unit verdicts,
// moves the job to a terminal state ("completed" when accepted, otherwise
// "failed"), and inserts the judge.completed.v1 outbox event that Pull
// delivers -- all in one transaction, so a terminal job always has exactly one
// completion and a completion never exists for a non-terminal job. A unit
// without a recorded verdict counts as internal_error. The payload carries no
// encrypted result reference (the triple is all-or-none and Judge stores no
// result object); per-unit detail is joined from execution_units at Pull time.
func (a *DispatchStoreAdapter) MarkJobComplete(ctx context.Context, jobID string) error {
	transaction, err := a.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin completion of job %s: %w", jobID, err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	var correlationID string
	if err := transaction.QueryRow(ctx, `
		SELECT submission_correlation_id::text FROM judge.execution_jobs WHERE id = $1 FOR UPDATE
	`, jobID).Scan(&correlationID); err != nil {
		return fmt.Errorf("lock job %s for completion: %w", jobID, err)
	}
	var verdicts []string
	var maxTimeMS *int
	var maxMemoryBytes *int64
	if err := transaction.QueryRow(ctx, `
		SELECT COALESCE(array_agg(COALESCE(normalized_verdict, 'internal_error')), ARRAY[]::text[]),
		       max(cpu_time_ms), max(memory_bytes)
		FROM judge.execution_units
		WHERE job_id = $1
	`, jobID).Scan(&verdicts, &maxTimeMS, &maxMemoryBytes); err != nil {
		return fmt.Errorf("read unit verdicts of job %s: %w", jobID, err)
	}
	overall := dispatcher.OverallVerdict(verdicts)

	jobState := "failed"
	if overall == "accepted" {
		jobState = "completed"
	}
	if _, err := transaction.Exec(ctx, `
		UPDATE judge.execution_jobs
		SET state       = $2,
		    terminal_at = clock_timestamp(),
		    updated_at  = clock_timestamp()
		WHERE id = $1
	`, jobID, jobState); err != nil {
		return fmt.Errorf("mark job %s complete with state %s: %w", jobID, jobState, err)
	}

	now := time.Now().UTC()
	payload := completionPayload{
		SubmissionCorrelationID: correlationID,
		Verdict:                 overall,
		CompletedAt:             now.Format(time.RFC3339Nano),
	}
	if maxTimeMS != nil {
		timeMS := uint32(*maxTimeMS)
		payload.ExecutionTimeMS = &timeMS
	}
	if maxMemoryBytes != nil {
		memoryKiB := uint32(*maxMemoryBytes / 1024)
		payload.MemoryKiB = &memoryKiB
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode completion of job %s: %w", jobID, err)
	}
	checksum := sha256.Sum256(payloadJSON)
	eventID, err := database.NewUUIDv7()
	if err != nil {
		return err
	}
	if _, err := transaction.Exec(ctx, `
		INSERT INTO judge.outbox_events (event_id, aggregate_id, event_type, payload, payload_sha256, expires_at)
		VALUES ($1, $2, 'judge.completed.v1', $3::jsonb, $4, $5)
	`, eventID, jobID, payloadJSON, hex.EncodeToString(checksum[:]), now.Add(completionRetention)); err != nil {
		return fmt.Errorf("record completion of job %s: %w", jobID, err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit completion of job %s: %w", jobID, err)
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
		SELECT unit_number, normalized_verdict, cpu_time_ms, memory_bytes, weight
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
		var weight int
		if err := rows.Scan(&unitNumber, &verdict, &timeMS, &memoryBytes, &weight); err != nil {
			return nil, fmt.Errorf("scan unit result for job %s: %w", jobID, err)
		}
		result := dispatcher.UnitResult{UnitNumber: unitNumber, TimeMS: timeMS, Weight: weight}
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
