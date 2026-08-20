package messaging

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nats-io/nats.go"
)

var qualifiedTablePattern = regexp.MustCompile(`^[a-z_][a-z0-9_]{0,62}\.[a-z_][a-z0-9_]{0,62}$`)

// LeasedEvent is an outbox event claimed by one publisher until LeaseUntil.
// Duplicate publication remains safe because the publisher always uses the
// durable event ID as the NATS de-duplication ID.
type LeasedEvent struct {
	database.OutboxEvent
	LeaseUntil time.Time
}

// OutboxStore persists and leases events from one service-owned outbox table.
// The table name is configuration, not request data, and is validated before
// being interpolated into SQL.
type OutboxStore struct {
	pool  *pgxpool.Pool
	table string
}

// NewOutboxStore constructs an outbox store for a qualified schema.table name.
func NewOutboxStore(pool *pgxpool.Pool, table string) (*OutboxStore, error) {
	if pool == nil {
		return nil, fmt.Errorf("outbox pool is required")
	}
	table = strings.TrimSpace(table)
	if !qualifiedTablePattern.MatchString(table) {
		return nil, fmt.Errorf("outbox table must be a qualified lowercase identifier")
	}
	return &OutboxStore{pool: pool, table: table}, nil
}

// Enqueue writes an event within the caller's already-open business
// transaction, preserving the state-change/outbox atomicity guarantee.
func (store *OutboxStore) Enqueue(contextValue context.Context, transaction pgx.Tx, event database.OutboxEvent) error {
	if store == nil || transaction == nil {
		return fmt.Errorf("outbox store and transaction are required")
	}
	if err := event.Validate(); err != nil {
		return err
	}
	payloadHash := sha256.Sum256(event.Payload)
	var tenantID any
	if strings.TrimSpace(event.TenantID) != "" {
		tenantID = event.TenantID
	}
	_, err := transaction.Exec(contextValue, fmt.Sprintf(`
		INSERT INTO %s (
			event_id, aggregate_type, aggregate_id, tenant_id, event_type,
			schema_version, payload, payload_sha256, occurred_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, store.table), event.EventID, event.AggregateType, event.AggregateID, tenantID,
		event.EventType, event.SchemaVersion, event.Payload, payloadHash[:], event.OccurredAt.UTC())
	if err != nil {
		return fmt.Errorf("enqueue outbox event: %w", err)
	}
	return nil
}

// Lease claims up to limit eligible events without blocking other publisher
// replicas. A lease timeout turns a crashed publisher into an at-least-once
// replay rather than a stranded event.
func (store *OutboxStore) Lease(contextValue context.Context, limit int, leaseDuration time.Duration) ([]LeasedEvent, error) {
	if store == nil || store.pool == nil {
		return nil, fmt.Errorf("outbox store is not initialized")
	}
	if limit < 1 || limit > 1000 {
		return nil, fmt.Errorf("outbox lease limit must be between 1 and 1000")
	}
	if leaseDuration < time.Second || leaseDuration > 5*time.Minute {
		return nil, fmt.Errorf("outbox lease duration must be between one second and five minutes")
	}
	rows, err := store.pool.Query(contextValue, fmt.Sprintf(`
		WITH candidates AS (
			SELECT event_id
			FROM %s
			WHERE published_at IS NULL
			  AND next_attempt_at <= clock_timestamp()
			  AND (locked_until IS NULL OR locked_until < clock_timestamp())
			ORDER BY occurred_at, event_id
			FOR UPDATE SKIP LOCKED
			LIMIT $1
		)
		UPDATE %s AS event
		SET locked_until = clock_timestamp() + $2::interval
		FROM candidates
		WHERE event.event_id = candidates.event_id
		RETURNING event.event_id, event.aggregate_type, event.aggregate_id,
		          COALESCE(event.tenant_id::text, ''), event.event_type,
		          event.schema_version, event.payload, event.occurred_at,
		          event.locked_until
	`, store.table, store.table), limit, leaseDuration.String())
	if err != nil {
		return nil, fmt.Errorf("lease outbox events: %w", err)
	}
	defer rows.Close()
	leased := make([]LeasedEvent, 0, limit)
	for rows.Next() {
		var event LeasedEvent
		if err := rows.Scan(
			&event.EventID, &event.AggregateType, &event.AggregateID, &event.TenantID,
			&event.EventType, &event.SchemaVersion, &event.Payload, &event.OccurredAt,
			&event.LeaseUntil,
		); err != nil {
			return nil, fmt.Errorf("scan leased outbox event: %w", err)
		}
		leased = append(leased, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate leased outbox events: %w", err)
	}
	return leased, nil
}

// MarkPublished records a broker-confirmed event delivery. The exact lease
// predicate prevents a stale publisher from acknowledging a newer lease.
func (store *OutboxStore) MarkPublished(contextValue context.Context, event LeasedEvent) (bool, error) {
	if store == nil || store.pool == nil {
		return false, fmt.Errorf("outbox store is not initialized")
	}
	command, err := store.pool.Exec(contextValue, fmt.Sprintf(`
		UPDATE %s
		SET published_at = clock_timestamp(), locked_until = NULL, last_error = NULL
		WHERE event_id = $1 AND published_at IS NULL AND locked_until = $2
	`, store.table), event.EventID, event.LeaseUntil)
	if err != nil {
		return false, fmt.Errorf("mark outbox event published: %w", err)
	}
	return command.RowsAffected() == 1, nil
}

// Release records a failed publish and schedules a bounded exponential retry.
func (store *OutboxStore) Release(contextValue context.Context, event LeasedEvent, publishError error) error {
	if store == nil || store.pool == nil {
		return fmt.Errorf("outbox store is not initialized")
	}
	if publishError == nil {
		return fmt.Errorf("outbox publish error is required")
	}
	_, err := store.pool.Exec(contextValue, fmt.Sprintf(`
		UPDATE %s
		SET publication_attempts = publication_attempts + 1,
			locked_until = NULL,
			last_error = left($3, 2048),
			next_attempt_at = clock_timestamp() + LEAST(
				interval '5 minutes',
				interval '1 second' * power(2, LEAST(publication_attempts + 1, 8))
			)
		WHERE event_id = $1 AND published_at IS NULL AND locked_until = $2
	`, store.table), event.EventID, event.LeaseUntil, publishError.Error())
	if err != nil {
		return fmt.Errorf("release outbox event: %w", err)
	}
	return nil
}

// PublishBatch publishes leased events to JetStream. The event type is the
// subject, and Nats-Msg-Id makes retry/replay idempotent at the broker layer.
func PublishBatch(contextValue context.Context, store *OutboxStore, stream nats.JetStreamContext, events []LeasedEvent) error {
	if stream == nil {
		return fmt.Errorf("JetStream context is required")
	}
	for _, event := range events {
		payload, err := json.Marshal(Event{
			ID: event.EventID, Type: event.EventType, SchemaVersion: event.SchemaVersion,
			AggregateType: event.AggregateType, AggregateID: event.AggregateID,
			TenantID: event.TenantID, OccurredAt: event.OccurredAt.UTC(), Payload: event.Payload,
		})
		if err != nil {
			return fmt.Errorf("encode outbox event %s: %w", event.EventID, err)
		}
		message := nats.NewMsg(event.EventType)
		message.Header.Set(nats.MsgIdHdr, event.EventID)
		message.Data = payload
		if _, err := stream.PublishMsg(message, nats.Context(contextValue)); err != nil {
			if releaseErr := store.Release(contextValue, event, err); releaseErr != nil {
				return fmt.Errorf("publish outbox event %s: %w; release: %w", event.EventID, err, releaseErr)
			}
			return fmt.Errorf("publish outbox event %s: %w", event.EventID, err)
		}
		if _, err := store.MarkPublished(contextValue, event); err != nil {
			return fmt.Errorf("acknowledge outbox event %s: %w", event.EventID, err)
		}
	}
	return nil
}
