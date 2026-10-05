// Package projection consumes cross-service lifecycle events. Attempt
// submission and assignment revocation close active SEB sessions, and every
// assignment snapshot is kept so the exam lockdown check knows which exams a
// candidate is sitting (ADR-0022). It never reads Submission or Assessment
// databases directly.
package projection

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/messaging"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	AttemptSubmittedEventType   = "submission.attempt_submitted.v1"
	AssignmentSnapshotEventType = "assessment.candidate_assignment.snapshot.v1"
)

type LifecycleStore struct {
	pool *pgxpool.Pool
}

func NewLifecycleStore(pool *pgxpool.Pool) (*LifecycleStore, error) {
	if pool == nil {
		return nil, fmt.Errorf("seb lifecycle projection database pool is required")
	}
	return &LifecycleStore{pool: pool}, nil
}

func (store *LifecycleStore) Ping(ctx context.Context) error {
	if store == nil || store.pool == nil {
		return fmt.Errorf("seb lifecycle projection store is not initialized")
	}
	if err := store.pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping seb lifecycle projection: %w", err)
	}
	return nil
}

type attemptSubmittedPayload struct {
	TenantID    string `json:"tenant_id"`
	AttemptID   string `json:"attempt_id"`
	CandidateID string `json:"candidate_id"`
}

type assignmentSnapshotPayload struct {
	TenantID              string     `json:"tenant_id"`
	CandidateAssignmentID string     `json:"candidate_assignment_id"`
	CandidateID           string     `json:"candidate_id"`
	ExamID                string     `json:"exam_id"`
	AvailableFrom         *time.Time `json:"available_from"`
	AvailableUntil        *time.Time `json:"available_until"`
	LifecycleState        string     `json:"lifecycle_state"`
	Version               int64      `json:"version"`
}

func (store *LifecycleStore) ApplyAttemptSubmitted(ctx context.Context, event messaging.Event) error {
	payload, err := parseAttemptSubmitted(event)
	if err != nil {
		return messaging.Permanent(err)
	}
	return store.apply(ctx, "seb_attempt_submitted_v2", event, func(transaction pgx.Tx) error {
		if _, err := transaction.Exec(ctx, `
			SELECT seb.close_sessions_for_attempt($1, $2, $3, $4)
		`, event.ID, payload.TenantID, payload.AttemptID, "submitted"); err != nil {
			return projectionError(err, "close SEB sessions for submitted attempt")
		}
		return nil
	})
}

// ApplyAssignmentSnapshot records the assignment and, when it is revoked,
// closes the candidate's active sessions.
func (store *LifecycleStore) ApplyAssignmentSnapshot(ctx context.Context, event messaging.Event) error {
	payload, err := parseAssignmentSnapshot(event)
	if err != nil {
		return messaging.Permanent(err)
	}
	return store.apply(ctx, "seb_assignment_snapshot_v2", event, func(transaction pgx.Tx) error {
		if _, err := transaction.Exec(ctx, `
			SELECT seb.apply_candidate_assignment_snapshot($1, $2, $3, $4, $5, $6, $7, $8)
		`, payload.TenantID, payload.CandidateAssignmentID, payload.CandidateID, payload.ExamID,
			payload.AvailableFrom, payload.AvailableUntil, payload.LifecycleState, payload.Version); err != nil {
			return projectionError(err, "record candidate assignment snapshot")
		}
		if payload.LifecycleState != "revoked" {
			return nil
		}
		if _, err := transaction.Exec(ctx, `
			SELECT seb.close_sessions_for_candidate($1, $2, $3, $4)
		`, event.ID, payload.TenantID, payload.CandidateID, "assignment_revoked"); err != nil {
			return projectionError(err, "close SEB sessions for revoked assignment")
		}
		return nil
	})
}

func (store *LifecycleStore) apply(ctx context.Context, consumer string, event messaging.Event, apply func(pgx.Tx) error) error {
	if store == nil || store.pool == nil {
		return fmt.Errorf("seb lifecycle projection store is not initialized")
	}
	transaction, err := store.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin seb lifecycle projection transaction: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	payloadHash := sha256.Sum256(event.Payload)
	var claimedID string
	err = transaction.QueryRow(ctx, `
		INSERT INTO seb.projection_inbox_messages (
			consumer_name, event_id, payload_sha256, occurred_at
		) VALUES ($1, $2, $3, $4)
		ON CONFLICT (consumer_name, event_id) DO NOTHING
		RETURNING event_id::text
	`, consumer, event.ID, payloadHash[:], event.OccurredAt.UTC()).Scan(&claimedID)
	if errors.Is(err, pgx.ErrNoRows) {
		if commitErr := transaction.Commit(ctx); commitErr != nil {
			return fmt.Errorf("commit duplicate seb lifecycle projection event: %w", commitErr)
		}
		return nil
	}
	if err != nil {
		return fmt.Errorf("claim seb lifecycle projection event: %w", err)
	}
	if err := apply(transaction); err != nil {
		return err
	}
	if _, err := transaction.Exec(ctx, `
		UPDATE seb.projection_inbox_messages
		SET processed_at = clock_timestamp(), last_error = NULL
		WHERE consumer_name = $1 AND event_id = $2
	`, consumer, claimedID); err != nil {
		return fmt.Errorf("complete seb lifecycle projection event: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit seb lifecycle projection event: %w", err)
	}
	return nil
}

func parseAttemptSubmitted(event messaging.Event) (attemptSubmittedPayload, error) {
	if event.Type != AttemptSubmittedEventType || event.SchemaVersion != 1 || !validUUID(event.ID) {
		return attemptSubmittedPayload{}, fmt.Errorf("unsupported attempt submitted event")
	}
	var payload attemptSubmittedPayload
	if err := decodePayload(event.Payload, &payload); err != nil {
		return attemptSubmittedPayload{}, err
	}
	if !validUUID(payload.TenantID) || !validUUID(payload.AttemptID) || !validUUID(payload.CandidateID) {
		return attemptSubmittedPayload{}, fmt.Errorf("attempt submitted payload is invalid")
	}
	return payload, nil
}

func parseAssignmentSnapshot(event messaging.Event) (assignmentSnapshotPayload, error) {
	if event.Type != AssignmentSnapshotEventType || event.SchemaVersion != 1 || !validUUID(event.ID) {
		return assignmentSnapshotPayload{}, fmt.Errorf("unsupported assignment snapshot event")
	}
	var payload assignmentSnapshotPayload
	if err := decodePayload(event.Payload, &payload); err != nil {
		return assignmentSnapshotPayload{}, err
	}
	if !validUUID(payload.TenantID) || !validUUID(payload.CandidateAssignmentID) || !validUUID(payload.CandidateID) ||
		!validUUID(payload.ExamID) || payload.Version <= 0 {
		return assignmentSnapshotPayload{}, fmt.Errorf("assignment snapshot payload is invalid")
	}
	if payload.LifecycleState != "active" && payload.LifecycleState != "revoked" {
		return assignmentSnapshotPayload{}, fmt.Errorf("assignment snapshot lifecycle_state is invalid")
	}
	return payload, nil
}

// decodePayload reads the fields this projection needs. Producers add fields
// to a versioned event without bumping its version, so unknown fields are
// ignored; a breaking change gets a new event type.
func decodePayload(raw []byte, target any) error {
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("decode seb lifecycle projection payload: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("seb lifecycle projection payload must contain exactly one JSON value")
	}
	return nil
}

func projectionError(err error, operation string) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && (postgresError.Code == "P0001" || postgresError.Code == "22P02" || postgresError.Code == "23514") {
		return messaging.Permanent(fmt.Errorf("%s: %w", operation, err))
	}
	return fmt.Errorf("%s: %w", operation, err)
}

func validUUID(value string) bool {
	parsed, err := uuid.Parse(strings.TrimSpace(value))
	return err == nil && strings.EqualFold(parsed.String(), strings.TrimSpace(value))
}
