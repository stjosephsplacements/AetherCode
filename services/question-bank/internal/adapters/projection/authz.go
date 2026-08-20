// Package projection applies User's complete authorization snapshots to the
// Question Bank's global RLS projection. It never reads User's database.
package projection

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/messaging"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const AuthorizationSnapshotEventType = "authz.grants_snapshot.v1"

const zeroUUID = "00000000-0000-0000-0000-000000000000"

type GlobalAuthorizationProjection struct {
	pool *pgxpool.Pool
}

func NewGlobalAuthorizationProjection(pool *pgxpool.Pool) (*GlobalAuthorizationProjection, error) {
	if pool == nil {
		return nil, fmt.Errorf("question bank authorization projection database pool is required")
	}
	return &GlobalAuthorizationProjection{pool: pool}, nil
}

func (projection *GlobalAuthorizationProjection) Ping(contextValue context.Context) error {
	if projection == nil || projection.pool == nil {
		return fmt.Errorf("question bank authorization projection is not initialized")
	}
	if err := projection.pool.Ping(contextValue); err != nil {
		return fmt.Errorf("ping Question Bank authorization projection database: %w", err)
	}
	return nil
}

// Apply replaces the one global grant representation for a principal at a
// newer canonical revision. An empty platform grant set is a durable revoke,
// so local RLS denies while the consumer catches up.
func (projection *GlobalAuthorizationProjection) Apply(contextValue context.Context, event messaging.Event) error {
	if projection == nil || projection.pool == nil {
		return fmt.Errorf("question bank authorization projection is not initialized")
	}
	payload, err := parseSnapshot(event)
	if err != nil {
		return messaging.Permanent(err)
	}

	transaction, err := projection.pool.BeginTx(contextValue, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin Question Bank authorization projection transaction: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()

	payloadHash := sha256.Sum256(event.Payload)
	var claimedID string
	err = transaction.QueryRow(contextValue, `
		INSERT INTO authz.projection_inbox_messages (
			message_id, event_type, payload_checksum
		) VALUES ($1, $2, $3)
		ON CONFLICT (message_id) DO NOTHING
		RETURNING message_id::text
	`, event.ID, event.Type, hex.EncodeToString(payloadHash[:])).Scan(&claimedID)
	if errors.Is(err, pgx.ErrNoRows) {
		if commitErr := transaction.Commit(contextValue); commitErr != nil {
			return fmt.Errorf("commit duplicate Question Bank authorization snapshot: %w", commitErr)
		}
		return nil
	}
	if err != nil {
		return fmt.Errorf("claim Question Bank authorization snapshot: %w", err)
	}

	if _, err := transaction.Exec(contextValue, `
		SELECT authz.apply_global_authorization($1, $2, $3, $4, $5, $6)
	`, payload.PrincipalID, payload.AuthorizationRevision, payload.HasPlatformGrant,
		payload.HasPlatformGrant, payload.HasPlatformGrant, payload.PlatformExpiresAt); err != nil {
		return projectionWriteError(err, "apply Question Bank global authorization")
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE authz.projection_inbox_messages
		SET processed_at = clock_timestamp(), last_error = NULL
		WHERE message_id = $1
	`, claimedID); err != nil {
		return fmt.Errorf("complete Question Bank authorization snapshot inbox record: %w", err)
	}
	if err := transaction.Commit(contextValue); err != nil {
		return fmt.Errorf("commit Question Bank authorization snapshot: %w", err)
	}
	return nil
}

type authorizationSnapshot struct {
	PrincipalID           string  `json:"principal_id"`
	AuthorizationRevision int64   `json:"authz_revision"`
	Reason                string  `json:"reason"`
	Grants                []grant `json:"grants"`
	HasPlatformGrant      bool
	PlatformExpiresAt     *time.Time
}

type grant struct {
	GrantKind     string `json:"grant_kind"`
	TenantID      string `json:"tenant_id"`
	GrantSourceID string `json:"grant_source_id"`
	ExpiresAt     string `json:"expires_at"`
}

func parseSnapshot(event messaging.Event) (authorizationSnapshot, error) {
	if event.Type != AuthorizationSnapshotEventType || event.SchemaVersion != 1 || !validUUID(event.ID) {
		return authorizationSnapshot{}, fmt.Errorf("authorization snapshot event is invalid")
	}
	decoder := json.NewDecoder(strings.NewReader(string(event.Payload)))
	decoder.DisallowUnknownFields()
	var payload authorizationSnapshot
	if err := decoder.Decode(&payload); err != nil {
		return authorizationSnapshot{}, fmt.Errorf("decode authorization snapshot payload: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err == nil {
		return authorizationSnapshot{}, fmt.Errorf("authorization snapshot payload contains more than one value")
	} else if !errors.Is(err, io.EOF) {
		return authorizationSnapshot{}, fmt.Errorf("authorization snapshot payload is invalid")
	}
	if !validUUID(payload.PrincipalID) || payload.AuthorizationRevision <= 0 {
		return authorizationSnapshot{}, fmt.Errorf("authorization snapshot principal or revision is invalid")
	}
	seen := make(map[string]struct{}, len(payload.Grants))
	for _, item := range payload.Grants {
		expiresAt, err := validateGrant(item)
		if err != nil {
			return authorizationSnapshot{}, err
		}
		key := item.GrantKind + "|" + item.TenantID + "|" + item.GrantSourceID
		if _, duplicate := seen[key]; duplicate {
			return authorizationSnapshot{}, fmt.Errorf("authorization snapshot contains a duplicate grant")
		}
		seen[key] = struct{}{}
		if item.GrantKind == "platform" {
			payload.HasPlatformGrant = true
			payload.PlatformExpiresAt = expiresAt
		}
	}
	return payload, nil
}

func validateGrant(item grant) (*time.Time, error) {
	var expiresAt *time.Time
	if item.ExpiresAt != "" {
		parsed, err := time.Parse(time.RFC3339Nano, item.ExpiresAt)
		if err != nil {
			return nil, fmt.Errorf("authorization snapshot grant expiry is invalid")
		}
		utc := parsed.UTC()
		expiresAt = &utc
	}
	switch item.GrantKind {
	case "platform":
		if item.TenantID != zeroUUID || item.GrantSourceID != zeroUUID {
			return nil, fmt.Errorf("platform authorization grant has invalid scope")
		}
	case "tenant":
		if !validUUID(item.TenantID) || item.TenantID != item.GrantSourceID {
			return nil, fmt.Errorf("tenant authorization grant has invalid scope")
		}
	case "placement":
		if !validUUID(item.TenantID) || !validUUID(item.GrantSourceID) {
			return nil, fmt.Errorf("placement authorization grant has invalid scope")
		}
	default:
		return nil, fmt.Errorf("authorization snapshot grant kind is invalid")
	}
	return expiresAt, nil
}

func projectionWriteError(err error, operation string) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && (postgresError.Code == "P0001" || postgresError.Code == "22P02" || postgresError.Code == "23514") {
		return messaging.Permanent(fmt.Errorf("%s: %w", operation, err))
	}
	return fmt.Errorf("%s: %w", operation, err)
}

func validUUID(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) != 36 {
		return false
	}
	for index, character := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			if character != '-' {
				return false
			}
			continue
		}
		//nolint:staticcheck // QF1001: the negated-range form reads more clearly for character validation
		if !(character >= '0' && character <= '9') && !(character >= 'a' && character <= 'f') {
			return false
		}
	}
	return true
}
