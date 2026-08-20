// Package repo provides the PostgreSQL control-plane adapter for Judge.
package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/aethercode/aethercode/services/judge/internal/app"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres is the Judge wrapper's sole persistence adapter. It never connects
// to the upstream Judge0 database.
type Postgres struct {
	pool *pgxpool.Pool
}

// NewPostgres creates a wrapper store over a service-owned connection pool.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool}
}

// Ping reports database readiness without exposing credentials or SQL details.
func (repository *Postgres) Ping(contextValue context.Context) error {
	if err := repository.pool.Ping(contextValue); err != nil {
		return fmt.Errorf("ping Judge control database: %w", err)
	}
	return nil
}

// Submit accepts one idempotent execution request and records an append-only
// event for the RabbitMQ admission publisher.
func (repository *Postgres) Submit(contextValue context.Context, request app.SubmitExecution) (app.Execution, error) {
	fingerprint, err := request.Fingerprint()
	if err != nil {
		return app.Execution{}, err
	}

	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return app.Execution{}, fmt.Errorf("begin execution acceptance: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()

	existing, found, err := findExecutionByIdempotencyKey(contextValue, transaction, request.IdempotencyKey)
	if err != nil {
		return app.Execution{}, err
	}
	if found {
		if existing.fingerprint != fingerprint {
			return app.Execution{}, app.ErrIdempotencyConflict
		}
		if err := transaction.Commit(contextValue); err != nil {
			return app.Execution{}, fmt.Errorf("commit idempotent execution lookup: %w", err)
		}
		return app.Execution{ID: existing.id, Status: existing.state}, nil
	}

	var enabled bool
	err = transaction.QueryRow(contextValue, `
		SELECT enabled
		FROM judge.language_mappings
		WHERE language_key = $1
	`, request.LanguageKey).Scan(&enabled)
	if errors.Is(err, pgx.ErrNoRows) || !enabled {
		return app.Execution{}, app.ErrLanguageUnavailable
	}
	if err != nil {
		return app.Execution{}, fmt.Errorf("look up language mapping: %w", err)
	}

	jobID, err := database.NewUUIDv7()
	if err != nil {
		return app.Execution{}, err
	}
	eventID, err := database.NewUUIDv7()
	if err != nil {
		return app.Execution{}, err
	}
	admissionEventID, err := database.NewUUIDv7()
	if err != nil {
		return app.Execution{}, err
	}
	payload, err := json.Marshal(struct {
		SubmissionCorrelationID string `json:"submission_correlation_id"`
		LanguageKey             string `json:"language_key"`
	}{
		SubmissionCorrelationID: request.SubmissionCorrelationID,
		LanguageKey:             request.LanguageKey,
	})
	if err != nil {
		return app.Execution{}, fmt.Errorf("encode accepted execution event: %w", err)
	}

	var insertedJobID string
	err = transaction.QueryRow(contextValue, `
		INSERT INTO judge.execution_jobs (
			id, idempotency_key, request_fingerprint, tenant_fairness_key,
			submission_correlation_id, evaluation_bundle_ref, evaluation_bundle_sha256,
			source_ciphertext_ref, source_ciphertext_sha256, request_ciphertext_ref, language_key,
			cpu_time_limit_ms, wall_time_limit_ms, memory_limit_bytes, process_limit,
			expires_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
		)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING id
	`,
		jobID, request.IdempotencyKey, fingerprint, request.TenantFairnessKey,
		request.SubmissionCorrelationID, request.EvaluationBundleRef, request.EvaluationBundleSHA256,
		request.SourceCiphertextRef, request.SourceCiphertextSHA256, request.RequestCiphertextRef, request.LanguageKey,
		request.Limits.CPUTimeMS, request.Limits.WallTimeMS, request.Limits.Memory, request.Limits.Processes,
		request.ExpiresAt.UTC(),
	).Scan(&insertedJobID)
	if errors.Is(err, pgx.ErrNoRows) {
		existing, found, lookupErr := findExecutionByIdempotencyKey(contextValue, transaction, request.IdempotencyKey)
		if lookupErr != nil {
			return app.Execution{}, lookupErr
		}
		if !found || existing.fingerprint != fingerprint {
			return app.Execution{}, app.ErrIdempotencyConflict
		}
		if err := transaction.Commit(contextValue); err != nil {
			return app.Execution{}, fmt.Errorf("commit concurrent idempotency lookup: %w", err)
		}
		return app.Execution{ID: existing.id, Status: existing.state}, nil
	}
	if err != nil {
		return app.Execution{}, fmt.Errorf("insert execution job: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		INSERT INTO judge.execution_events (event_id, job_id, event_type, payload)
		VALUES ($1, $2, 'execution.accepted.v1', $3::jsonb)
	`, eventID, insertedJobID, payload); err != nil {
		return app.Execution{}, fmt.Errorf("record accepted execution event: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		INSERT INTO judge.admission_outbox (event_id, job_id, expires_at)
		VALUES ($1, $2, $3)
	`, admissionEventID, insertedJobID, request.ExpiresAt.UTC()); err != nil {
		return app.Execution{}, fmt.Errorf("record execution admission: %w", err)
	}
	if err := transaction.Commit(contextValue); err != nil {
		return app.Execution{}, fmt.Errorf("commit execution acceptance: %w", err)
	}
	return app.Execution{ID: insertedJobID, Status: "accepted"}, nil
}

type existingExecution struct {
	id          string
	fingerprint string
	state       string
}

func findExecutionByIdempotencyKey(contextValue context.Context, transaction pgx.Tx, key string) (existingExecution, bool, error) {
	var execution existingExecution
	err := transaction.QueryRow(contextValue, `
		SELECT id, request_fingerprint, state
		FROM judge.execution_jobs
		WHERE idempotency_key = $1 AND deleted_at IS NULL
	`, key).Scan(&execution.id, &execution.fingerprint, &execution.state)
	if errors.Is(err, pgx.ErrNoRows) {
		return existingExecution{}, false, nil
	}
	if err != nil {
		return existingExecution{}, false, fmt.Errorf("look up idempotency key: %w", err)
	}
	return execution, true, nil
}

// SoftDeleteExecutionJob marks a job as deleted without physical removal.
func (repository *Postgres) SoftDeleteExecutionJob(contextValue context.Context, command app.DeleteExecutionJob) error {
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin soft delete execution job: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()

	result, err := transaction.Exec(contextValue, `
		UPDATE judge.execution_jobs
		SET deleted_at = clock_timestamp(), deleted_by = $2::uuid, deletion_reason = $3
		WHERE id = $1 AND deleted_at IS NULL
	`, command.ID, command.ActorID, command.Reason)
	if err != nil {
		return fmt.Errorf("soft delete execution job: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("execution job not found or already deleted")
	}
	if err := transaction.Commit(contextValue); err != nil {
		return fmt.Errorf("commit soft delete execution job: %w", err)
	}
	return nil
}

// HardDeleteExecutionJob permanently removes a job via security-definer function.
func (repository *Postgres) HardDeleteExecutionJob(contextValue context.Context, command app.DeleteExecutionJob) error {
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin hard delete execution job: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()

	var success bool
	err = transaction.QueryRow(contextValue, `
		SELECT app.hard_delete($1, $2::uuid, $3::uuid, $4)
	`, "judge.execution_jobs", command.ID, command.ActorID, command.Reason).Scan(&success)
	if err != nil {
		return fmt.Errorf("hard delete execution job: %w", err)
	}
	if !success {
		return fmt.Errorf("hard delete denied: insufficient permissions or record not found")
	}
	if err := transaction.Commit(contextValue); err != nil {
		return fmt.Errorf("commit hard delete execution job: %w", err)
	}
	return nil
}

type completionPayload struct {
	SubmissionCorrelationID      string  `json:"submission_correlation_id"`
	ResultRef                    string  `json:"result_ref"`
	ResultSHA256                 string  `json:"result_sha256"`
	ResultEncryptionKeyReference string  `json:"result_encryption_key_reference"`
	Verdict                      string  `json:"verdict"`
	ExecutionTimeMS              *uint32 `json:"execution_time_ms"`
	MemoryKiB                    *uint32 `json:"memory_kib"`
	CompletedAt                  string  `json:"completed_at"`
}

type pendingCompletion struct {
	eventID    string
	jobID      string
	payloadRaw []byte
}

// Pull atomically leases completed outbox events to the platform adapter. A
// crashed consumer's lease becomes available again after the requested bounded
// lease period, so a Judge worker/node loss cannot lose grading results.
func (repository *Postgres) Pull(
	contextValue context.Context,
	request app.PullCompletedExecutions,
) ([]app.Completion, error) {
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return nil, fmt.Errorf("begin completion pull: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()

	rows, err := transaction.Query(contextValue, `
		SELECT event_id, aggregate_id, payload
		FROM judge.outbox_events
		WHERE (state = 'pending' AND available_at <= clock_timestamp())
		   OR (state = 'leased' AND lease_expires_at <= clock_timestamp())
		ORDER BY available_at, created_at
		FOR UPDATE SKIP LOCKED
		LIMIT $1
	`, request.Limit)
	if err != nil {
		return nil, fmt.Errorf("select completed executions: %w", err)
	}
	defer rows.Close()

	pending := make([]pendingCompletion, 0, request.Limit)
	for rows.Next() {
		var completion pendingCompletion
		if err := rows.Scan(&completion.eventID, &completion.jobID, &completion.payloadRaw); err != nil {
			return nil, fmt.Errorf("scan completed execution: %w", err)
		}
		pending = append(pending, completion)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate completed executions: %w", err)
	}

	leaseUntil := time.Now().UTC().Add(time.Duration(request.LeaseSeconds) * time.Second)
	completions := make([]app.Completion, 0, len(pending))
	for _, pendingCompletion := range pending {
		deliveryID, err := database.NewUUIDv7()
		if err != nil {
			return nil, err
		}
		leaseID, err := database.NewUUIDv7()
		if err != nil {
			return nil, err
		}
		if _, err := transaction.Exec(contextValue, `
			UPDATE judge.outbox_events
			SET state = 'leased', lease_owner = $2, lease_id = $3,
				lease_expires_at = $4, updated_at = clock_timestamp()
			WHERE event_id = $1
		`, pendingCompletion.eventID, request.ConsumerID, leaseID, leaseUntil); err != nil {
			return nil, fmt.Errorf("lease completion outbox event: %w", err)
		}
		if _, err := transaction.Exec(contextValue, `
			INSERT INTO judge.completion_deliveries (
				delivery_id, consumer_id, event_id, lease_id, leased_at, lease_expires_at
			) VALUES ($1, $2, $3, $4, clock_timestamp(), $5)
		`, deliveryID, request.ConsumerID, pendingCompletion.eventID, leaseID, leaseUntil); err != nil {
			return nil, fmt.Errorf("record completion delivery: %w", err)
		}

		var payload completionPayload
		if err := json.Unmarshal(pendingCompletion.payloadRaw, &payload); err != nil {
			return nil, fmt.Errorf("decode completion payload: %w", err)
		}
		completedAt, err := time.Parse(time.RFC3339Nano, payload.CompletedAt)
		if err != nil {
			return nil, fmt.Errorf("parse completion timestamp: %w", err)
		}
		completion := app.Completion{
			EventID:                 pendingCompletion.eventID,
			JobID:                   pendingCompletion.jobID,
			SubmissionCorrelationID: payload.SubmissionCorrelationID,
			ResultRef:               payload.ResultRef,
			ResultSHA256:            payload.ResultSHA256,
			ResultEncryptionKeyRef:  payload.ResultEncryptionKeyReference,
			Verdict:                 payload.Verdict,
			ExecutionTimeMS:         payload.ExecutionTimeMS,
			MemoryKiB:               payload.MemoryKiB,
			DeliveryID:              deliveryID,
			LeaseID:                 leaseID,
			CompletedAt:             completedAt.UTC(),
		}
		if err := completion.Validate(); err != nil {
			return nil, fmt.Errorf("validate completion payload: %w", err)
		}
		completions = append(completions, completion)
	}
	if err := transaction.Commit(contextValue); err != nil {
		return nil, fmt.Errorf("commit completion pull: %w", err)
	}
	return completions, nil
}

// Acknowledge marks an exact leased completion terminal only after the
// platform adapter has independently persisted it.
func (repository *Postgres) Acknowledge(
	contextValue context.Context,
	request app.AcknowledgeCompletion,
) error {
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin completion acknowledgement: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()

	// Claim the outbox transition first, with the exact live lease predicate.
	// This UPDATE locks the outbox row. A concurrent re-pull cannot replace an
	// expired lease between delivery validation and acknowledgement.
	command, err := transaction.Exec(contextValue, `
		UPDATE judge.outbox_events
		SET state = 'acknowledged', acknowledged_at = clock_timestamp(),
			lease_owner = NULL, lease_id = NULL, lease_expires_at = NULL,
			updated_at = clock_timestamp()
		WHERE event_id = $1
		  AND state = 'leased'
		  AND lease_owner = $2
		  AND lease_id = $3
		  AND lease_expires_at > clock_timestamp()
	`, request.EventID, request.ConsumerID, request.LeaseID)
	if err != nil {
		return fmt.Errorf("claim completion outbox acknowledgement: %w", err)
	}
	if command.RowsAffected() != 1 {
		return app.ErrCompletionNotLeased
	}
	command, err = transaction.Exec(contextValue, `
		UPDATE judge.completion_deliveries
		SET acknowledged_at = clock_timestamp(), updated_at = clock_timestamp()
		WHERE consumer_id = $1
		  AND event_id = $2
		  AND delivery_id = $3
		  AND lease_id = $4
		  AND acknowledged_at IS NULL
		  AND lease_expires_at > clock_timestamp()
	`, request.ConsumerID, request.EventID, request.DeliveryID, request.LeaseID)
	if err != nil {
		return fmt.Errorf("acknowledge completion delivery: %w", err)
	}
	if command.RowsAffected() != 1 {
		return app.ErrCompletionNotLeased
	}
	if err := transaction.Commit(contextValue); err != nil {
		return fmt.Errorf("commit completion acknowledgement: %w", err)
	}
	return nil
}
