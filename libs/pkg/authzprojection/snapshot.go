// Package authzprojection applies User's complete effective-grant snapshots to
// a service-local FORCE RLS projection. It deliberately knows no domain tables
// beyond the private authz schema contract shared by target services.
package authzprojection

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/messaging"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const SnapshotEventType = "authz.grants_snapshot.v1"

const maximumSnapshotPayloadBytes = 1 << 20

var snapshotReasonPattern = regexp.MustCompile(`^[a-z][a-z0-9._-]{0,127}$`)

type grant struct {
	GrantKind     string `json:"grant_kind"`
	TenantID      string `json:"tenant_id"`
	GrantSourceID string `json:"grant_source_id"`
	ExpiresAt     string `json:"expires_at"`
}

type snapshotPayload struct {
	PrincipalID      string  `json:"principal_id"`
	AuthorizationRev int64   `json:"authz_revision"`
	Reason           string  `json:"reason"`
	Grants           []grant `json:"grants"`
}

// Store owns the projection worker's dedicated connection pool. Application
// credentials never receive the DML grants required by this type.
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) (*Store, error) {
	if pool == nil {
		return nil, fmt.Errorf("authorization projection database pool is required")
	}
	return &Store{pool: pool}, nil
}

func (store *Store) Ping(contextValue context.Context) error {
	if store == nil || store.pool == nil {
		return fmt.Errorf("authorization projection store is not initialized")
	}
	if err := store.pool.Ping(contextValue); err != nil {
		return fmt.Errorf("ping authorization projection database: %w", err)
	}
	return nil
}

// Apply atomically claims the event, replaces the complete grant set only if
// its revision is current, and marks the local inbox complete. Duplicate and
// stale events are therefore harmless.
func (store *Store) Apply(contextValue context.Context, event messaging.Event) error {
	if store == nil || store.pool == nil {
		return fmt.Errorf("authorization projection store is not initialized")
	}
	payload, err := parseSnapshot(event)
	if err != nil {
		return messaging.Permanent(err)
	}
	grantsPayload, err := json.Marshal(payload.Grants)
	if err != nil {
		return fmt.Errorf("encode authorization snapshot grants: %w", err)
	}
	transaction, err := store.pool.BeginTx(contextValue, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin authorization snapshot transaction: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()
	payloadHash := sha256.Sum256(event.Payload)
	var claimedID string
	err = transaction.QueryRow(contextValue, `
		INSERT INTO authz.authorization_snapshot_inbox_messages (
			event_id, payload_sha256, occurred_at
		) VALUES ($1, $2, $3)
		ON CONFLICT (event_id) DO NOTHING
		RETURNING event_id::text
	`, event.ID, payloadHash[:], event.OccurredAt.UTC()).Scan(&claimedID)
	if errors.Is(err, pgx.ErrNoRows) {
		if commitErr := transaction.Commit(contextValue); commitErr != nil {
			return fmt.Errorf("commit duplicate authorization snapshot: %w", commitErr)
		}
		return nil
	}
	if err != nil {
		return fmt.Errorf("claim authorization snapshot: %w", err)
	}
	var applied bool
	if err := transaction.QueryRow(contextValue, `
		SELECT authz.apply_authorization_snapshot($1, $2, $3::jsonb)
	`, payload.PrincipalID, payload.AuthorizationRev, grantsPayload).Scan(&applied); err != nil {
		return projectionError(err, "apply authorization snapshot")
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE authz.authorization_snapshot_inbox_messages
		SET processed_at = clock_timestamp(), last_error = NULL
		WHERE event_id = $1
	`, claimedID); err != nil {
		return fmt.Errorf("complete authorization snapshot inbox record: %w", err)
	}
	if err := transaction.Commit(contextValue); err != nil {
		return fmt.Errorf("commit authorization snapshot: %w", err)
	}
	_ = applied // A stale event is a successful idempotent no-op.
	return nil
}

func parseSnapshot(event messaging.Event) (snapshotPayload, error) {
	if event.Type != SnapshotEventType || event.SchemaVersion != 1 {
		return snapshotPayload{}, fmt.Errorf("unsupported authorization snapshot event")
	}
	if !validUUID(event.ID) {
		return snapshotPayload{}, fmt.Errorf("authorization snapshot event ID is invalid")
	}
	return parseSnapshotPayload(event.Payload)
}

// parseSnapshotPayload validates the immutable inner snapshot shape used by
// both the established grants-snapshot event and the targeted resync batch.
// Keeping this parser shared prevents a recovery path from accepting a weaker
// contract than ordinary revision propagation.
func parseSnapshotPayload(rawPayload []byte) (snapshotPayload, error) {
	if len(rawPayload) == 0 || len(rawPayload) > maximumSnapshotPayloadBytes {
		return snapshotPayload{}, fmt.Errorf("authorization snapshot payload size is invalid")
	}
	decoder := json.NewDecoder(strings.NewReader(string(rawPayload)))
	decoder.DisallowUnknownFields()
	var payload snapshotPayload
	if err := decoder.Decode(&payload); err != nil {
		return snapshotPayload{}, fmt.Errorf("decode authorization snapshot payload: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return snapshotPayload{}, fmt.Errorf("decode authorization snapshot payload: exactly one JSON value is required")
	}
	if !validUUID(payload.PrincipalID) || payload.AuthorizationRev <= 0 {
		return snapshotPayload{}, fmt.Errorf("authorization snapshot principal or revision is invalid")
	}
	if !snapshotReasonPattern.MatchString(payload.Reason) {
		return snapshotPayload{}, fmt.Errorf("authorization snapshot reason is invalid")
	}
	seen := make(map[string]struct{}, len(payload.Grants))
	for _, item := range payload.Grants {
		if err := validateGrant(item); err != nil {
			return snapshotPayload{}, err
		}
		key := item.GrantKind + "|" + item.TenantID + "|" + item.GrantSourceID
		if _, duplicate := seen[key]; duplicate {
			return snapshotPayload{}, fmt.Errorf("authorization snapshot contains a duplicate grant")
		}
		seen[key] = struct{}{}
	}
	return payload, nil
}

func validateGrant(item grant) error {
	const zeroUUID = "00000000-0000-0000-0000-000000000000"
	if item.ExpiresAt != "" {
		if _, err := time.Parse(time.RFC3339Nano, item.ExpiresAt); err != nil {
			return fmt.Errorf("authorization snapshot grant expiry is invalid")
		}
	}
	switch item.GrantKind {
	case "platform":
		if item.TenantID != zeroUUID || item.GrantSourceID != zeroUUID {
			return fmt.Errorf("platform authorization grant has invalid scope")
		}
	case "tenant":
		if !validUUID(item.TenantID) || item.TenantID != item.GrantSourceID {
			return fmt.Errorf("tenant authorization grant has invalid scope")
		}
	case "placement":
		if !validUUID(item.TenantID) || !validUUID(item.GrantSourceID) {
			return fmt.Errorf("placement authorization grant has invalid scope")
		}
	default:
		return fmt.Errorf("authorization snapshot grant kind is invalid")
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
