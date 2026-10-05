package judgecompletion

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store uses the dedicated adapter pool. The database role has EXECUTE-only
// access to submission.ingest_judge_completion and cannot select candidate
// records or write any table directly.
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) (*Store, error) {
	if pool == nil {
		return nil, fmt.Errorf("judge completion adapter database pool is required")
	}
	return &Store{pool: pool}, nil
}

func (store *Store) Ping(contextValue context.Context) error {
	if store == nil || store.pool == nil {
		return fmt.Errorf("judge completion adapter store is not initialized")
	}
	if err := store.pool.Ping(contextValue); err != nil {
		return fmt.Errorf("ping Judge completion adapter database: %w", err)
	}
	return nil
}

// Persist records the incoming lease and emits judge.completed.v1 in the same
// transaction. A retry of the same Judge event verifies an immutable payload
// fingerprint and adds only its new delivery lease.
func (store *Store) Persist(contextValue context.Context, consumerID string, completion Completion) error {
	if err := completion.Validate(); err != nil {
		return err
	}
	outboxEventID, err := database.NewUUIDv7()
	if err != nil {
		return err
	}
	unitResults, err := encodeUnitResults(completion.UnitResults)
	if err != nil {
		return err
	}
	transaction, err := store.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin Judge completion persistence: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()
	var persistedOutboxEventID string
	err = transaction.QueryRow(contextValue, `
		SELECT submission.ingest_judge_completion(
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb
		)
	`, outboxEventID, completion.JudgeEventID, completion.DeliveryID, completion.LeaseID,
		consumerID, completion.EvaluationRequestID, completion.JudgeJobID, completion.Verdict,
		completion.ExecutionTimeMS, completion.MemoryKiB, nullableString(completion.ResultObjectKey),
		nullableString(completion.ResultChecksum), nullableString(completion.EncryptionKeyReference),
		completion.CompletedAt.UTC(), unitResults).Scan(&persistedOutboxEventID)
	if err != nil {
		return fmt.Errorf("persist Judge completion ingress: %w", err)
	}
	if persistedOutboxEventID == "" {
		return fmt.Errorf("judge completion ingress returned an empty outbox event id")
	}
	if err := transaction.Commit(contextValue); err != nil {
		return fmt.Errorf("commit Judge completion persistence: %w", err)
	}
	return nil
}

// encodeUnitResults always produces a JSON array. An absent breakdown is an
// empty array rather than a JSON null, because the ingress routine stores the
// value in a jsonb array column and compares it on every replayed delivery.
func encodeUnitResults(units []UnitResult) (string, error) {
	if len(units) == 0 {
		return "[]", nil
	}
	encoded, err := json.Marshal(units)
	if err != nil {
		return "", fmt.Errorf("encode Judge completion unit results: %w", err)
	}
	return string(encoded), nil
}

func nullableString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

// RunForJob looks the job up among candidate runs.
func (store *Store) RunForJob(contextValue context.Context, judgeJobID string) (RunTarget, bool, error) {
	var target RunTarget
	err := store.pool.QueryRow(contextValue, `
		SELECT tenant_id::text, code_run_id::text FROM submission.code_run_for_job($1)
	`, judgeJobID).Scan(&target.TenantID, &target.RunID)
	if errors.Is(err, pgx.ErrNoRows) {
		return RunTarget{}, false, nil
	}
	if err != nil {
		return RunTarget{}, false, fmt.Errorf("look up code run for Judge job: %w", err)
	}
	return target, true, nil
}

// PersistRun records a run's units with their output. A replay of a run
// already completed is a no-op.
func (store *Store) PersistRun(contextValue context.Context, run RunCompletion) error {
	units, err := json.Marshal(run.Units)
	if err != nil {
		return fmt.Errorf("encode code run units: %w", err)
	}
	if _, err := store.pool.Exec(contextValue, `
		SELECT submission.record_code_run_completion($1, $2, $3, $4, $5::jsonb)
	`, run.Target.TenantID, run.Target.RunID, run.JudgeJobID, run.Verdict, string(units)); err != nil {
		return fmt.Errorf("record code run completion: %w", err)
	}
	return nil
}
