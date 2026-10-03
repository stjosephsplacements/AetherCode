// Package projection consumes the tenant-owned retention and legal-hold event
// contracts into Notification's local retention projection. It never reads
// Tenant's database directly.
package projection

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/aethercode/aethercode/libs/pkg/messaging"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	RetentionPolicyEvent   = "tenant.retention_policy.updated.v2"
	LegalHoldPlacedEvent   = "tenant.legal_hold.placed.v2"
	LegalHoldReleasedEvent = "tenant.legal_hold.released.v2"
)

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) (*Store, error) {
	if pool == nil {
		return nil, fmt.Errorf("notification projection database pool is required")
	}
	return &Store{pool: pool}, nil
}

func (store *Store) Ping(ctx context.Context) error {
	if store == nil || store.pool == nil {
		return fmt.Errorf("notification retention projection store is not initialized")
	}
	if err := store.pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping notification retention projection: %w", err)
	}
	return nil
}

type retentionPolicyPayload struct {
	TenantID                 string `json:"tenant_id"`
	NotificationDeliveryDays int    `json:"notification_delivery_days"`
	Version                  int    `json:"version"`
}

type legalHoldPayload struct {
	LegalHoldID string `json:"legal_hold_id"`
	TenantID    string `json:"tenant_id"`
	Scope       string `json:"scope"`
	SubjectID   string `json:"subject_id"`
	Status      string `json:"status"`
}

func (store *Store) ApplyRetentionPolicy(ctx context.Context, event messaging.Event) error {
	payload, err := parseRetentionPolicy(event)
	if err != nil {
		return messaging.Permanent(err)
	}
	return store.apply(ctx, "notification_tenant_retention_v2", event, func(transaction pgx.Tx) error {
		var applied bool
		if err := transaction.QueryRow(ctx, `
			SELECT notification.apply_retention_policy_projection($1, $2, $3, $4, $5)
		`, event.ID, payload.TenantID, payload.NotificationDeliveryDays, payload.Version, event.OccurredAt.UTC()).Scan(&applied); err != nil {
			return projectionError(err, "apply notification retention policy")
		}
		return nil
	})
}

func (store *Store) ApplyLegalHoldPlaced(ctx context.Context, event messaging.Event) error {
	payload, err := parseLegalHold(event, LegalHoldPlacedEvent, "active")
	if err != nil {
		return messaging.Permanent(err)
	}
	return store.applyLegalHold(ctx, "notification_tenant_legal_hold_placed_v2", event, payload)
}

func (store *Store) ApplyLegalHoldReleased(ctx context.Context, event messaging.Event) error {
	payload, err := parseLegalHold(event, LegalHoldReleasedEvent, "released")
	if err != nil {
		return messaging.Permanent(err)
	}
	return store.applyLegalHold(ctx, "notification_tenant_legal_hold_released_v2", event, payload)
}

func (store *Store) applyLegalHold(ctx context.Context, consumer string, event messaging.Event, payload legalHoldPayload) error {
	return store.apply(ctx, consumer, event, func(transaction pgx.Tx) error {
		var applied bool
		var subjectID any
		if payload.SubjectID != "" {
			subjectID = payload.SubjectID
		}
		if err := transaction.QueryRow(ctx, `
			SELECT notification.apply_legal_hold_projection($1, $2, $3, $4, $5::uuid, $6, $7)
		`, event.ID, payload.LegalHoldID, payload.TenantID, payload.Scope, subjectID, payload.Status, event.OccurredAt.UTC()).Scan(&applied); err != nil {
			return projectionError(err, "apply notification legal hold")
		}
		return nil
	})
}

func (store *Store) apply(ctx context.Context, consumer string, event messaging.Event, apply func(pgx.Tx) error) error {
	if store == nil || store.pool == nil {
		return fmt.Errorf("notification projection store is not initialized")
	}
	transaction, err := store.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin notification projection transaction: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	payloadHash := sha256.Sum256(event.Payload)
	var claimedID string
	err = transaction.QueryRow(ctx, `
		INSERT INTO notification.projection_inbox_messages (
			consumer_name, event_id, payload_sha256, occurred_at
		) VALUES ($1, $2, $3, $4)
		ON CONFLICT (consumer_name, event_id) DO NOTHING
		RETURNING event_id::text
	`, consumer, event.ID, payloadHash[:], event.OccurredAt.UTC()).Scan(&claimedID)
	if errors.Is(err, pgx.ErrNoRows) {
		if commitErr := transaction.Commit(ctx); commitErr != nil {
			return fmt.Errorf("commit duplicate notification projection event: %w", commitErr)
		}
		return nil
	}
	if err != nil {
		return fmt.Errorf("claim notification projection event: %w", err)
	}
	if err := apply(transaction); err != nil {
		return err
	}
	if _, err := transaction.Exec(ctx, `
		UPDATE notification.projection_inbox_messages
		SET processed_at = clock_timestamp(), last_error = NULL
		WHERE consumer_name = $1 AND event_id = $2
	`, consumer, claimedID); err != nil {
		return fmt.Errorf("complete notification projection event: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit notification projection event: %w", err)
	}
	return nil
}

func parseRetentionPolicy(event messaging.Event) (retentionPolicyPayload, error) {
	if event.Type != RetentionPolicyEvent || event.SchemaVersion != 1 || !validUUID(event.ID) {
		return retentionPolicyPayload{}, fmt.Errorf("unsupported tenant retention policy event")
	}
	var payload retentionPolicyPayload
	if err := decodePayload(event.Payload, &payload); err != nil {
		return retentionPolicyPayload{}, err
	}
	if !validUUID(payload.TenantID) || payload.NotificationDeliveryDays < 30 || payload.NotificationDeliveryDays > 3650 || payload.Version < 1 {
		return retentionPolicyPayload{}, fmt.Errorf("tenant retention policy payload is invalid")
	}
	return payload, nil
}

func parseLegalHold(event messaging.Event, expectedType, expectedStatus string) (legalHoldPayload, error) {
	if event.Type != expectedType || event.SchemaVersion != 1 || !validUUID(event.ID) {
		return legalHoldPayload{}, fmt.Errorf("unsupported tenant legal hold event")
	}
	var payload legalHoldPayload
	if err := decodePayload(event.Payload, &payload); err != nil {
		return legalHoldPayload{}, err
	}
	if !validUUID(payload.LegalHoldID) || !validUUID(payload.TenantID) || payload.Status != expectedStatus {
		return legalHoldPayload{}, fmt.Errorf("tenant legal hold payload is invalid")
	}
	if payload.Scope == "tenant" {
		if payload.SubjectID != "" {
			return legalHoldPayload{}, fmt.Errorf("tenant legal hold must not have a subject")
		}
	} else if (payload.Scope != "student" && payload.Scope != "assessment" && payload.Scope != "submission") || !validUUID(payload.SubjectID) {
		return legalHoldPayload{}, fmt.Errorf("tenant legal hold subject is invalid")
	}
	return payload, nil
}

func decodePayload(raw []byte, target any) error {
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("decode notification projection payload: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("notification projection payload must contain exactly one JSON value")
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
