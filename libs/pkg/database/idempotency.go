package database

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/jackc/pgx/v5"
)

var idempotencyTablePattern = regexp.MustCompile(`^[a-z_][a-z0-9_]{0,62}\.[a-z_][a-z0-9_]{0,62}$`)

// IdempotencyState is the durable lifecycle of one request key.
type IdempotencyState string

const (
	IdempotencyInProgress IdempotencyState = "in_progress"
	IdempotencyCompleted  IdempotencyState = "completed"
	IdempotencyFailed     IdempotencyState = "failed"
)

// IdempotencyRecord is either a newly claimed request or the durable response
// from a prior equivalent request. ResponseBody is JSON when State is
// completed; binary responses belong in object storage and use the object
// fields instead.
type IdempotencyRecord struct {
	Acquired          bool
	State             IdempotencyState
	ResponseStatus    int
	ResponseBody      json.RawMessage
	ResponseObjectKey string
	ResponseChecksum  string
}

// IdempotencyStore operates on the common service-local idempotency schema.
// It must be used inside the same transaction as the protected state change
// and durable outbox enqueue.
type IdempotencyStore struct {
	table string
	now   func() time.Time
}

// NewIdempotencyStore validates a compile-time controlled table name. Request
// data is never interpolated into SQL.
func NewIdempotencyStore(table string) (*IdempotencyStore, error) {
	table = strings.TrimSpace(table)
	if !idempotencyTablePattern.MatchString(table) {
		return nil, fmt.Errorf("idempotency table must be a qualified lowercase identifier")
	}
	return &IdempotencyStore{table: table, now: time.Now}, nil
}

// HashRequestBody returns the lowercase SHA-256 request fingerprint persisted
// with an idempotency key. It requires one valid JSON value to avoid treating
// arbitrary byte spelling as an API request format.
func HashRequestBody(body []byte) (string, error) {
	if !json.Valid(body) {
		return "", apperrors.New(apperrors.CodeInvalidArgument, "idempotency request body must be valid JSON")
	}
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:]), nil
}

// Claim acquires a key once or returns its durable result. The unique index
// serializes concurrent requests for one key: a concurrent caller waits for
// the first transaction, then sees the completed result rather than executing
// the state change twice.
func (store *IdempotencyStore) Claim(
	ctx context.Context,
	transaction pgx.Tx,
	tenantID, operation, key, requestHash string,
	expiresAt time.Time,
) (IdempotencyRecord, error) {
	if store == nil || transaction == nil {
		return IdempotencyRecord{}, fmt.Errorf("idempotency store and transaction are required")
	}
	tenantID = strings.ToLower(strings.TrimSpace(tenantID))
	operation = strings.TrimSpace(operation)
	key = strings.TrimSpace(key)
	requestHash = strings.ToLower(strings.TrimSpace(requestHash))
	if len(tenantID) > 0 && !uuidV7OrUUID(tenantID) {
		return IdempotencyRecord{}, apperrors.New(apperrors.CodeInvalidArgument, "idempotency tenant ID is invalid")
	}
	if len(operation) == 0 || len(operation) > 160 || len(key) == 0 || len(key) > 255 || !sha256HexPattern.MatchString(requestHash) {
		return IdempotencyRecord{}, apperrors.New(apperrors.CodeInvalidArgument, "idempotency key, operation, or request hash is invalid")
	}
	now := store.now().UTC()
	if expiresAt.IsZero() || !expiresAt.After(now) || expiresAt.After(now.Add(7*24*time.Hour)) {
		return IdempotencyRecord{}, apperrors.New(apperrors.CodeInvalidArgument, "idempotency expiry must be within seven days")
	}

	// An expired key can be reused safely. Limit deletion to the exact key so
	// request traffic never becomes a broad retention cleanup operation.
	if _, err := transaction.Exec(ctx, fmt.Sprintf(`
		DELETE FROM %s
		WHERE scope_key = COALESCE(NULLIF($1, '')::uuid::text, 'global')
		  AND operation = $2 AND idempotency_key = $3
		  AND expires_at <= clock_timestamp()
	`, store.table), tenantID, operation, key); err != nil {
		return IdempotencyRecord{}, fmt.Errorf("purge expired idempotency key: %w", err)
	}

	var state string
	err := transaction.QueryRow(ctx, fmt.Sprintf(`
		INSERT INTO %s (
			tenant_id, operation, idempotency_key, request_hash, state, expires_at
		) VALUES (NULLIF($1, '')::uuid, $2, $3, $4, 'in_progress', $5)
		ON CONFLICT (scope_key, operation, idempotency_key) DO NOTHING
		RETURNING state
	`, store.table), tenantID, operation, key, requestHash, expiresAt.UTC()).Scan(&state)
	if err == nil {
		return IdempotencyRecord{Acquired: true, State: IdempotencyState(state)}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return IdempotencyRecord{}, fmt.Errorf("claim idempotency key: %w", err)
	}

	var record IdempotencyRecord
	var storedHash string
	err = transaction.QueryRow(ctx, fmt.Sprintf(`
		SELECT request_hash, state, COALESCE(response_status, 0),
		       COALESCE(response_body, 'null'::jsonb), COALESCE(response_object_key, ''),
		       COALESCE(response_checksum, '')
		FROM %s
		WHERE scope_key = COALESCE(NULLIF($1, '')::uuid::text, 'global')
		  AND operation = $2 AND idempotency_key = $3
		FOR UPDATE
	`, store.table), tenantID, operation, key).Scan(
		&storedHash, &state, &record.ResponseStatus, &record.ResponseBody,
		&record.ResponseObjectKey, &record.ResponseChecksum,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return IdempotencyRecord{}, fmt.Errorf("idempotency key disappeared during claim")
	}
	if err != nil {
		return IdempotencyRecord{}, fmt.Errorf("read idempotency key: %w", err)
	}
	if storedHash != requestHash {
		return IdempotencyRecord{}, apperrors.New(apperrors.CodeConflict, "idempotency key was already used for a different request")
	}
	record.State = IdempotencyState(state)
	return record, nil
}

// Complete records the exact JSON response of an acquired request before its
// transaction commits. A replay therefore remains safe even after a process
// crash immediately following the original response.
func (store *IdempotencyStore) Complete(
	ctx context.Context,
	transaction pgx.Tx,
	tenantID, operation, key string,
	status int,
	response json.RawMessage,
) error {
	if store == nil || transaction == nil {
		return fmt.Errorf("idempotency store and transaction are required")
	}
	tenantID = strings.ToLower(strings.TrimSpace(tenantID))
	operation, key = strings.TrimSpace(operation), strings.TrimSpace(key)
	if (tenantID != "" && !uuidV7OrUUID(tenantID)) || operation == "" || len(operation) > 160 || key == "" || len(key) > 255 || status < 100 || status > 599 || !json.Valid(response) {
		return apperrors.New(apperrors.CodeInvalidArgument, "idempotency completion is invalid")
	}
	command, err := transaction.Exec(ctx, fmt.Sprintf(`
		UPDATE %s
		SET state = 'completed', response_status = $4, response_body = $5::jsonb,
			completed_at = clock_timestamp()
		WHERE scope_key = COALESCE(NULLIF($1, '')::uuid::text, 'global')
		  AND operation = $2 AND idempotency_key = $3 AND state = 'in_progress'
	`, store.table), tenantID, operation, key, status, response)
	if err != nil {
		return fmt.Errorf("complete idempotency key: %w", err)
	}
	if command.RowsAffected() != 1 {
		return apperrors.New(apperrors.CodeConflict, "idempotency key is not available for completion")
	}
	return nil
}

var (
	sha256HexPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
	uuidPattern      = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
)

func uuidV7OrUUID(value string) bool {
	return uuidPattern.MatchString(value)
}
