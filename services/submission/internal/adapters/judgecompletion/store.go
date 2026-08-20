package judgecompletion

import (
	"context"
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
		return nil, fmt.Errorf("Judge completion adapter database pool is required")
	}
	return &Store{pool: pool}, nil
}

func (store *Store) Ping(contextValue context.Context) error {
	if store == nil || store.pool == nil {
		return fmt.Errorf("Judge completion adapter store is not initialized")
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
	transaction, err := store.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin Judge completion persistence: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()
	var persistedOutboxEventID string
	err = transaction.QueryRow(contextValue, `
		SELECT submission.ingest_judge_completion(
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
		)
	`, outboxEventID, completion.JudgeEventID, completion.DeliveryID, completion.LeaseID,
		consumerID, completion.EvaluationRequestID, completion.JudgeJobID, completion.Verdict,
		completion.ExecutionTimeMS, completion.MemoryKiB, nullableString(completion.ResultObjectKey),
		nullableString(completion.ResultChecksum), nullableString(completion.EncryptionKeyReference),
		completion.CompletedAt.UTC()).Scan(&persistedOutboxEventID)
	if err != nil {
		return fmt.Errorf("persist Judge completion ingress: %w", err)
	}
	if persistedOutboxEventID == "" {
		return fmt.Errorf("Judge completion ingress returned an empty outbox event id")
	}
	if err := transaction.Commit(contextValue); err != nil {
		return fmt.Errorf("commit Judge completion persistence: %w", err)
	}
	return nil
}

func nullableString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}
