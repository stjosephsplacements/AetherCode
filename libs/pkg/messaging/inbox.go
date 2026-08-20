package messaging

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// InboxStore idempotently applies an event and its local state change in one
// transaction. A duplicate event reaches neither the callback nor a second
// side effect.
type InboxStore struct {
	pool  *pgxpool.Pool
	table string
}

// NewInboxStore constructs an inbox store for an app-owned inbox table.
func NewInboxStore(pool *pgxpool.Pool, table string) (*InboxStore, error) {
	if pool == nil {
		return nil, fmt.Errorf("inbox pool is required")
	}
	table = strings.TrimSpace(table)
	if !qualifiedTablePattern.MatchString(table) {
		return nil, fmt.Errorf("inbox table must be a qualified lowercase identifier")
	}
	return &InboxStore{pool: pool, table: table}, nil
}

// Process calls apply only for the first successful delivery of an event to a
// named consumer. An apply error rolls back the inbox claim, allowing the
// message broker to retry it safely.
func (store *InboxStore) Process(
	contextValue context.Context,
	consumer string,
	event Event,
	apply func(context.Context, pgx.Tx, Event) error,
) (bool, error) {
	if store == nil || store.pool == nil || apply == nil {
		return false, fmt.Errorf("inbox store and apply callback are required")
	}
	consumer = strings.TrimSpace(consumer)
	if consumer == "" {
		return false, fmt.Errorf("inbox consumer is required")
	}
	if err := event.Validate(); err != nil {
		return false, err
	}
	transaction, err := store.pool.BeginTx(contextValue, pgx.TxOptions{})
	if err != nil {
		return false, fmt.Errorf("begin inbox transaction: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()
	payloadHash := sha256.Sum256(event.Payload)
	row := transaction.QueryRow(contextValue, fmt.Sprintf(`
		INSERT INTO %s (consumer_name, message_id, subject, occurred_at, payload_sha256)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (consumer_name, message_id) DO NOTHING
		RETURNING message_id
	`, store.table), consumer, event.ID, event.Type, event.OccurredAt.UTC(), payloadHash[:])
	var claimedID string
	if err := row.Scan(&claimedID); err != nil {
		if err == pgx.ErrNoRows {
			if commitErr := transaction.Commit(contextValue); commitErr != nil {
				return false, fmt.Errorf("commit duplicate inbox event: %w", commitErr)
			}
			return false, nil
		}
		return false, fmt.Errorf("claim inbox event: %w", err)
	}
	if err := apply(contextValue, transaction, event); err != nil {
		return false, err
	}
	if _, err := transaction.Exec(contextValue, fmt.Sprintf(`
		UPDATE %s SET processed_at = clock_timestamp()
		WHERE consumer_name = $1 AND message_id = $2
	`, store.table), consumer, event.ID); err != nil {
		return false, fmt.Errorf("mark inbox event processed: %w", err)
	}
	if err := transaction.Commit(contextValue); err != nil {
		return false, fmt.Errorf("commit inbox event: %w", err)
	}
	return true, nil
}
