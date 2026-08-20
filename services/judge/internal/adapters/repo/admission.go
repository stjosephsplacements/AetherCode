package repo

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/aethercode/aethercode/services/judge/internal/app"
	"github.com/jackc/pgx/v5"
)

// AdmissionLease is a DB-backed claim for a pointer-only RabbitMQ wake-up.
// Source, tests, requests, and results remain in PostgreSQL/object storage.
type AdmissionLease struct {
	EventID string
	JobID   string
	LeaseID string
}

// LeaseAdmissions claims ready admission rows without holding locks while the
// publisher performs network I/O. An unconfirmed publish is released for retry
// and a broker-confirmed duplicate is safe because workers deduplicate event ID.
func (repository *Postgres) LeaseAdmissions(
	contextValue context.Context,
	owner string,
	limit int,
	leaseFor time.Duration,
) ([]AdmissionLease, error) {
	if strings.TrimSpace(owner) == "" || len(owner) > 255 {
		return nil, fmt.Errorf("admission lease owner must contain 1 to 255 characters")
	}
	if limit < 1 || limit > 100 {
		return nil, fmt.Errorf("admission lease limit must be between 1 and 100")
	}
	if leaseFor < 5*time.Second || leaseFor > 5*time.Minute {
		return nil, fmt.Errorf("admission lease duration must be between 5 seconds and 5 minutes")
	}
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return nil, fmt.Errorf("begin admission lease: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()

	rows, err := transaction.Query(contextValue, `
		SELECT event_id, job_id
		FROM judge.admission_outbox
		WHERE (state = 'pending' AND available_at <= clock_timestamp())
		   OR (state = 'leased' AND lease_expires_at <= clock_timestamp())
		ORDER BY available_at, created_at
		FOR UPDATE SKIP LOCKED
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("select admission outbox rows: %w", err)
	}
	defer rows.Close()

	leases := make([]AdmissionLease, 0, limit)
	leaseExpiresAt := time.Now().UTC().Add(leaseFor)
	for rows.Next() {
		var lease AdmissionLease
		if err := rows.Scan(&lease.EventID, &lease.JobID); err != nil {
			return nil, fmt.Errorf("scan admission outbox row: %w", err)
		}
		leaseID, err := database.NewUUIDv7()
		if err != nil {
			return nil, err
		}
		lease.LeaseID = leaseID
		command, err := transaction.Exec(contextValue, `
			UPDATE judge.admission_outbox
			SET state = 'leased', lease_owner = $2, lease_id = $3,
				lease_expires_at = $4, publish_attempt_count = publish_attempt_count + 1,
				last_publish_error = NULL, updated_at = clock_timestamp()
			WHERE event_id = $1
		`, lease.EventID, owner, lease.LeaseID, leaseExpiresAt)
		if err != nil {
			return nil, fmt.Errorf("lease admission outbox row: %w", err)
		}
		if command.RowsAffected() != 1 {
			return nil, fmt.Errorf("admission outbox row %s disappeared while locked", lease.EventID)
		}
		leases = append(leases, lease)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate admission outbox rows: %w", err)
	}
	if err := transaction.Commit(contextValue); err != nil {
		return nil, fmt.Errorf("commit admission lease: %w", err)
	}
	return leases, nil
}

// MarkAdmissionPublished records a broker-confirmed pointer notification. The
// exact lease predicate prevents a delayed publisher from overwriting a retry.
func (repository *Postgres) MarkAdmissionPublished(contextValue context.Context, eventID, leaseID string) error {
	command, err := repository.pool.Exec(contextValue, `
		UPDATE judge.admission_outbox
		SET state = 'published', published_at = clock_timestamp(),
			lease_owner = NULL, lease_id = NULL, lease_expires_at = NULL,
			updated_at = clock_timestamp()
		WHERE event_id = $1
		  AND state = 'leased'
		  AND lease_id = $2
	`, eventID, leaseID)
	if err != nil {
		return fmt.Errorf("mark admission published: %w", err)
	}
	if command.RowsAffected() != 1 {
		return app.ErrAdmissionNotLeased
	}
	return nil
}

// ReleaseAdmission returns an unconfirmed lease to the durable retry queue.
func (repository *Postgres) ReleaseAdmission(
	contextValue context.Context,
	eventID, leaseID string,
	retryAt time.Time,
	publishError error,
) error {
	if publishError == nil {
		return fmt.Errorf("admission release requires a publish error")
	}
	detail := strings.TrimSpace(publishError.Error())
	if len(detail) > 2048 {
		detail = detail[:2048]
	}
	command, err := repository.pool.Exec(contextValue, `
		UPDATE judge.admission_outbox
		SET state = 'pending', available_at = $3, last_publish_error = $4,
			lease_owner = NULL, lease_id = NULL, lease_expires_at = NULL,
			updated_at = clock_timestamp()
		WHERE event_id = $1
		  AND state = 'leased'
		  AND lease_id = $2
	`, eventID, leaseID, retryAt.UTC(), detail)
	if err != nil {
		return fmt.Errorf("release admission lease: %w", err)
	}
	if command.RowsAffected() != 1 {
		return app.ErrAdmissionNotLeased
	}
	return nil
}

// RequeueStalePublishedAdmissions makes a broker-confirmed but never durably
// consumed pointer eligible for another idempotent publish. RabbitMQ retains
// durable messages independently, so this intentionally prefers a duplicate
// wake-up over an execution job stranded after a worker or broker recovery.
func (repository *Postgres) RequeueStalePublishedAdmissions(
	contextValue context.Context,
	publishedBefore time.Time,
	limit int,
) (int64, error) {
	if limit < 1 || limit > 1000 {
		return 0, fmt.Errorf("stale admission reconciliation limit must be between 1 and 1000")
	}
	command, err := repository.pool.Exec(contextValue, `
		WITH stale AS (
			SELECT event_id
			FROM judge.admission_outbox
			WHERE state = 'published'
			  AND consumed_at IS NULL
			  AND published_at <= $1
			ORDER BY published_at
			FOR UPDATE SKIP LOCKED
			LIMIT $2
		)
		UPDATE judge.admission_outbox AS admission
		SET state = 'pending', available_at = clock_timestamp(),
			last_publish_error = 'requeued after stale published admission reconciliation',
			updated_at = clock_timestamp()
		FROM stale
		WHERE admission.event_id = stale.event_id
	`, publishedBefore.UTC(), limit)
	if err != nil {
		return 0, fmt.Errorf("requeue stale published admissions: %w", err)
	}
	return command.RowsAffected(), nil
}
