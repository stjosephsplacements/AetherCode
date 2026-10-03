package authzprojection

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/aethercode/aethercode/libs/pkg/messaging"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// ResyncRequestWildcardSubject is consumed only by the canonical User
	// service. The target-service token lets NATS ACLs restrict each workload
	// to its own request subject.
	ResyncRequestWildcardSubject = "authz.grants_snapshot.resync_requested.*.v1"

	maximumResyncSnapshotCount = 100000
	maximumResyncPayloadBytes  = maximumSnapshotPayloadBytes + 4096
)

var (
	targetServicePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,62}$`)
	resyncReasonPattern  = regexp.MustCompile(`^[a-z][a-z0-9._-]{0,63}$`)
)

// ResyncRequest is a target service's durable request for a complete current
// authorization-grant batch. It contains no principal or grant data.
type ResyncRequest struct {
	ResyncID      string
	TargetService string
	Reason        string
}

type resyncRequestPayload struct {
	ResyncID      string `json:"resync_id"`
	TargetService string `json:"target_service"`
	Reason        string `json:"reason"`
}

type resyncSnapshotPayload struct {
	ResyncID      string          `json:"resync_id"`
	TargetService string          `json:"target_service"`
	Snapshot      json.RawMessage `json:"snapshot"`
	SnapshotSHA   string          `json:"snapshot_sha256"`
}

type resyncCompletedPayload struct {
	ResyncID      string `json:"resync_id"`
	TargetService string `json:"target_service"`
	SnapshotCount int    `json:"snapshot_count"`
	ManifestSHA   string `json:"manifest_sha256"`
}

type parsedResyncSnapshot struct {
	ResyncID      string
	TargetService string
	Snapshot      snapshotPayload
	SnapshotSHA   []byte
}

type parsedResyncCompletion struct {
	ResyncID      string
	TargetService string
	SnapshotCount int
	ManifestSHA   []byte
}

type resyncManifestItem struct {
	PrincipalID string
	Revision    int64
	SnapshotSHA string
}

// ResyncRequestSubject returns the only subject on which one target service
// may request a bootstrap. It is deliberately target-specific rather than a
// broad wildcard so broker ACLs can prevent cross-service amplification.
func ResyncRequestSubject(targetService string) (string, error) {
	targetService, err := normalizeTargetService(targetService)
	if err != nil {
		return "", err
	}
	return "authz.grants_snapshot.resync_requested." + targetService + ".v1", nil
}

// ResyncSnapshotSubject carries complete-grant snapshots only to their target
// service. The established authz.grants_snapshot.v1 contract is unchanged.
func ResyncSnapshotSubject(targetService string) (string, error) {
	targetService, err := normalizeTargetService(targetService)
	if err != nil {
		return "", err
	}
	return "authz.grants_snapshot.resync_snapshot." + targetService + ".v1", nil
}

// ResyncCompletedSubject closes a targeted batch after its manifest has been
// durably placed in the User outbox.
func ResyncCompletedSubject(targetService string) (string, error) {
	targetService, err := normalizeTargetService(targetService)
	if err != nil {
		return "", err
	}
	return "authz.grants_snapshot.resync_completed." + targetService + ".v1", nil
}

// ParseResyncRequest validates an incoming request before the canonical User
// service touches authorization data. A target may only name the exact
// subject corresponding to its payload target.
func ParseResyncRequest(event messaging.Event) (ResyncRequest, error) {
	if err := event.Validate(); err != nil {
		return ResyncRequest{}, fmt.Errorf("validate authorization resync request envelope: %w", err)
	}
	if !validUUIDv7(event.ID) {
		return ResyncRequest{}, fmt.Errorf("authorization resync request event ID is invalid")
	}
	if event.AggregateType != "authz_resync" || !validUUIDv7(event.AggregateID) || event.TenantID != "" {
		return ResyncRequest{}, fmt.Errorf("authorization resync request aggregate is invalid")
	}
	var payload resyncRequestPayload
	if err := decodeStrictPayload(event.Payload, &payload); err != nil {
		return ResyncRequest{}, fmt.Errorf("decode authorization resync request: %w", err)
	}
	targetService, err := normalizeTargetService(payload.TargetService)
	if err != nil || targetService != payload.TargetService {
		return ResyncRequest{}, fmt.Errorf("authorization resync request target service is invalid")
	}
	if !validUUIDv7(payload.ResyncID) || payload.ResyncID != event.AggregateID {
		return ResyncRequest{}, fmt.Errorf("authorization resync request ID is invalid")
	}
	if !resyncReasonPattern.MatchString(payload.Reason) {
		return ResyncRequest{}, fmt.Errorf("authorization resync request reason is invalid")
	}
	expectedSubject, err := ResyncRequestSubject(targetService)
	if err != nil || event.Type != expectedSubject || event.SchemaVersion != 1 {
		return ResyncRequest{}, fmt.Errorf("unsupported authorization resync request event")
	}
	return ResyncRequest{
		ResyncID:      payload.ResyncID,
		TargetService: targetService,
		Reason:        payload.Reason,
	}, nil
}

func parseResyncSnapshot(event messaging.Event) (parsedResyncSnapshot, error) {
	if err := event.Validate(); err != nil {
		return parsedResyncSnapshot{}, fmt.Errorf("validate authorization resync snapshot envelope: %w", err)
	}
	if !validUUID(event.ID) || event.AggregateType != "authz_resync" || event.TenantID != "" {
		return parsedResyncSnapshot{}, fmt.Errorf("authorization resync snapshot envelope is invalid")
	}
	var payload resyncSnapshotPayload
	if err := decodeStrictPayload(event.Payload, &payload); err != nil {
		return parsedResyncSnapshot{}, fmt.Errorf("decode authorization resync snapshot: %w", err)
	}
	targetService, err := normalizeTargetService(payload.TargetService)
	if err != nil || targetService != payload.TargetService {
		return parsedResyncSnapshot{}, fmt.Errorf("authorization resync snapshot target service is invalid")
	}
	if !validUUIDv7(payload.ResyncID) || payload.ResyncID != event.AggregateID {
		return parsedResyncSnapshot{}, fmt.Errorf("authorization resync snapshot ID is invalid")
	}
	expectedSubject, err := ResyncSnapshotSubject(targetService)
	if err != nil || event.Type != expectedSubject || event.SchemaVersion != 1 {
		return parsedResyncSnapshot{}, fmt.Errorf("unsupported authorization resync snapshot event")
	}
	if !validSHA256Hex(payload.SnapshotSHA) {
		return parsedResyncSnapshot{}, fmt.Errorf("authorization resync snapshot hash is invalid")
	}
	snapshotHash := sha256.Sum256(payload.Snapshot)
	if !strings.EqualFold(payload.SnapshotSHA, hex.EncodeToString(snapshotHash[:])) {
		return parsedResyncSnapshot{}, fmt.Errorf("authorization resync snapshot hash does not match payload")
	}
	snapshot, err := parseSnapshotPayload(payload.Snapshot)
	if err != nil {
		return parsedResyncSnapshot{}, err
	}
	return parsedResyncSnapshot{
		ResyncID:      payload.ResyncID,
		TargetService: targetService,
		Snapshot:      snapshot,
		SnapshotSHA:   snapshotHash[:],
	}, nil
}

func parseResyncCompletion(event messaging.Event) (parsedResyncCompletion, error) {
	if err := event.Validate(); err != nil {
		return parsedResyncCompletion{}, fmt.Errorf("validate authorization resync completion envelope: %w", err)
	}
	if !validUUID(event.ID) || event.AggregateType != "authz_resync" || event.TenantID != "" {
		return parsedResyncCompletion{}, fmt.Errorf("authorization resync completion envelope is invalid")
	}
	var payload resyncCompletedPayload
	if err := decodeStrictPayload(event.Payload, &payload); err != nil {
		return parsedResyncCompletion{}, fmt.Errorf("decode authorization resync completion: %w", err)
	}
	targetService, err := normalizeTargetService(payload.TargetService)
	if err != nil || targetService != payload.TargetService {
		return parsedResyncCompletion{}, fmt.Errorf("authorization resync completion target service is invalid")
	}
	if !validUUIDv7(payload.ResyncID) || payload.ResyncID != event.AggregateID {
		return parsedResyncCompletion{}, fmt.Errorf("authorization resync completion ID is invalid")
	}
	expectedSubject, err := ResyncCompletedSubject(targetService)
	if err != nil || event.Type != expectedSubject || event.SchemaVersion != 1 {
		return parsedResyncCompletion{}, fmt.Errorf("unsupported authorization resync completion event")
	}
	if payload.SnapshotCount < 0 || payload.SnapshotCount > maximumResyncSnapshotCount || !validSHA256Hex(payload.ManifestSHA) {
		return parsedResyncCompletion{}, fmt.Errorf("authorization resync completion manifest is invalid")
	}
	manifestHash, err := hex.DecodeString(payload.ManifestSHA)
	if err != nil {
		return parsedResyncCompletion{}, fmt.Errorf("decode authorization resync manifest hash: %w", err)
	}
	return parsedResyncCompletion{
		ResyncID:      payload.ResyncID,
		TargetService: targetService,
		SnapshotCount: payload.SnapshotCount,
		ManifestSHA:   manifestHash,
	}, nil
}

// ResyncStatus is the local fail-closed gate. ProjectionReady becomes true
// only after every item in the matching canonical manifest has been applied.
type ResyncStatus struct {
	ActiveResyncID  string
	ProjectionReady bool
	RequestedAt     time.Time
	CompletedAt     time.Time
	LastError       string
}

// ResyncStore implements the target-service half of the protocol. Its pool
// must authenticate as the dedicated projection worker. The target migration
// exposes only narrow SECURITY DEFINER functions plus the private authz state
// tables used here; request-serving application roles get neither privilege.
type ResyncStore struct {
	pool          *pgxpool.Pool
	targetService string
}

func NewResyncStore(pool *pgxpool.Pool, targetService string) (*ResyncStore, error) {
	if pool == nil {
		return nil, fmt.Errorf("authorization resync database pool is required")
	}
	targetService, err := normalizeTargetService(targetService)
	if err != nil {
		return nil, err
	}
	return &ResyncStore{pool: pool, targetService: targetService}, nil
}

// Start atomically marks the local projection stale and places a durable,
// application-generated UUIDv7 request in the service outbox. It never sends
// a best-effort broker message directly.
func (store *ResyncStore) Start(contextValue context.Context, reason string) (string, error) {
	if store == nil || store.pool == nil {
		return "", fmt.Errorf("authorization resync store is not initialized")
	}
	if !resyncReasonPattern.MatchString(reason) {
		return "", fmt.Errorf("authorization resync reason is invalid")
	}
	requestEventID, err := database.NewUUIDv7()
	if err != nil {
		return "", fmt.Errorf("generate authorization resync request event ID: %w", err)
	}
	resyncID, err := database.NewUUIDv7()
	if err != nil {
		return "", fmt.Errorf("generate authorization resync ID: %w", err)
	}
	var activeResyncID string
	if err := store.pool.QueryRow(contextValue, `
		SELECT authz.begin_authorization_projection_resync($1::uuid, $2::uuid, $3, $4)::text
	`, requestEventID, resyncID, store.targetService, reason).Scan(&activeResyncID); err != nil {
		return "", fmt.Errorf("begin authorization projection resync: %w", err)
	}
	if activeResyncID != resyncID || !validUUIDv7(activeResyncID) {
		return "", fmt.Errorf("authorization projection resync returned an unexpected ID")
	}
	return activeResyncID, nil
}

func (store *ResyncStore) Ping(contextValue context.Context) error {
	if store == nil || store.pool == nil {
		return fmt.Errorf("authorization resync store is not initialized")
	}
	if err := store.pool.Ping(contextValue); err != nil {
		return fmt.Errorf("ping authorization resync store: %w", err)
	}
	return nil
}

func (store *ResyncStore) Status(contextValue context.Context) (ResyncStatus, error) {
	if store == nil || store.pool == nil {
		return ResyncStatus{}, fmt.Errorf("authorization resync store is not initialized")
	}
	var status ResyncStatus
	var requestedAt *time.Time
	var completedAt *time.Time
	err := store.pool.QueryRow(contextValue, `
		SELECT COALESCE(active_resync_id::text, ''), projection_ready,
		       requested_at, completed_at, COALESCE(last_error, '')
		FROM authz.authorization_projection_resync_state
		WHERE singleton = true
	`).Scan(&status.ActiveResyncID, &status.ProjectionReady, &requestedAt, &completedAt, &status.LastError)
	if errors.Is(err, pgx.ErrNoRows) {
		return ResyncStatus{}, fmt.Errorf("authorization projection resync state is missing")
	}
	if err != nil {
		return ResyncStatus{}, fmt.Errorf("read authorization projection resync state: %w", err)
	}
	if requestedAt != nil {
		status.RequestedAt = requestedAt.UTC()
	}
	if completedAt != nil {
		status.CompletedAt = completedAt.UTC()
	}
	return status, nil
}

// Ready is intended for HTTP/gRPC readiness and remains an additional safety
// check beside the database's authz.set_context projection-ready gate.
func (store *ResyncStore) Ready(contextValue context.Context) error {
	status, err := store.Status(contextValue)
	if err != nil {
		return err
	}
	if !status.ProjectionReady {
		if status.ActiveResyncID == "" {
			return fmt.Errorf("authorization projection has not requested a bootstrap")
		}
		return fmt.Errorf("authorization projection resync %s is incomplete", status.ActiveResyncID)
	}
	return nil
}

// ApplySnapshot applies one targeted batch item. A response for an old or
// another service's resync is safely acknowledged without touching grants.
func (store *ResyncStore) ApplySnapshot(contextValue context.Context, event messaging.Event) error {
	if store == nil || store.pool == nil {
		return fmt.Errorf("authorization resync store is not initialized")
	}
	response, err := parseResyncSnapshot(event)
	if err != nil {
		return messaging.Permanent(err)
	}
	if response.TargetService != store.targetService {
		return messaging.Permanent(fmt.Errorf("authorization resync snapshot targets %q, not %q", response.TargetService, store.targetService))
	}
	transaction, err := store.pool.BeginTx(contextValue, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin authorization resync snapshot transaction: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()

	activeResyncID, err := lockActiveResync(contextValue, transaction)
	if err != nil {
		return err
	}
	if activeResyncID != response.ResyncID {
		if err := transaction.Commit(contextValue); err != nil {
			return fmt.Errorf("commit stale authorization resync snapshot: %w", err)
		}
		return nil
	}
	if err := verifyResyncSnapshotReplay(contextValue, transaction, event.ID, response); err != nil {
		return messaging.Permanent(err)
	}
	inserted, err := insertResyncSnapshotItem(contextValue, transaction, event.ID, response)
	if err != nil {
		return messaging.Permanent(err)
	}
	if inserted {
		if err := applySnapshotPayload(contextValue, transaction, response.Snapshot); err != nil {
			return projectionError(err, "apply authorization resync snapshot")
		}
	}
	if err := finalizeResync(contextValue, transaction, response.ResyncID); err != nil {
		return messaging.Permanent(err)
	}
	if err := transaction.Commit(contextValue); err != nil {
		return fmt.Errorf("commit authorization resync snapshot: %w", err)
	}
	return nil
}

// ApplyCompleted records the immutable expected batch manifest. It can arrive
// before, during, or after snapshots; every item calls finalizeResync again.
func (store *ResyncStore) ApplyCompleted(contextValue context.Context, event messaging.Event) error {
	if store == nil || store.pool == nil {
		return fmt.Errorf("authorization resync store is not initialized")
	}
	completion, err := parseResyncCompletion(event)
	if err != nil {
		return messaging.Permanent(err)
	}
	if completion.TargetService != store.targetService {
		return messaging.Permanent(fmt.Errorf("authorization resync completion targets %q, not %q", completion.TargetService, store.targetService))
	}
	transaction, err := store.pool.BeginTx(contextValue, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin authorization resync completion transaction: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()

	activeResyncID, err := lockActiveResync(contextValue, transaction)
	if err != nil {
		return err
	}
	if activeResyncID != completion.ResyncID {
		if err := transaction.Commit(contextValue); err != nil {
			return fmt.Errorf("commit stale authorization resync completion: %w", err)
		}
		return nil
	}
	if err := recordResyncCompletion(contextValue, transaction, event.ID, completion); err != nil {
		return messaging.Permanent(err)
	}
	if err := finalizeResync(contextValue, transaction, completion.ResyncID); err != nil {
		return messaging.Permanent(err)
	}
	if err := transaction.Commit(contextValue); err != nil {
		return fmt.Errorf("commit authorization resync completion: %w", err)
	}
	return nil
}

func lockActiveResync(contextValue context.Context, transaction pgx.Tx) (string, error) {
	var activeResyncID string
	err := transaction.QueryRow(contextValue, `
		SELECT COALESCE(active_resync_id::text, '')
		FROM authz.authorization_projection_resync_state
		WHERE singleton = true
		FOR UPDATE
	`).Scan(&activeResyncID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("authorization projection resync state is missing")
	}
	if err != nil {
		return "", fmt.Errorf("lock authorization projection resync state: %w", err)
	}
	return activeResyncID, nil
}

func verifyResyncSnapshotReplay(
	contextValue context.Context,
	transaction pgx.Tx,
	eventID string,
	response parsedResyncSnapshot,
) error {
	var existingResyncID string
	var existingPrincipalID string
	var existingRevision int64
	var existingHash []byte
	err := transaction.QueryRow(contextValue, `
		SELECT resync_id::text, principal_id::text, authz_revision, snapshot_sha256
		FROM authz.authorization_projection_resync_items
		WHERE source_event_id = $1
	`, eventID).Scan(&existingResyncID, &existingPrincipalID, &existingRevision, &existingHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read authorization resync snapshot replay: %w", err)
	}
	if existingResyncID != response.ResyncID || existingPrincipalID != response.Snapshot.PrincipalID ||
		existingRevision != response.Snapshot.AuthorizationRev || !equalBytes(existingHash, response.SnapshotSHA) {
		return fmt.Errorf("authorization resync snapshot event ID was replayed with different content")
	}
	return nil
}

func insertResyncSnapshotItem(
	contextValue context.Context,
	transaction pgx.Tx,
	eventID string,
	response parsedResyncSnapshot,
) (bool, error) {
	command, err := transaction.Exec(contextValue, `
		INSERT INTO authz.authorization_projection_resync_items (
			resync_id, principal_id, authz_revision, snapshot_sha256, source_event_id
		) VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid)
		ON CONFLICT (resync_id, principal_id) DO NOTHING
	`, response.ResyncID, response.Snapshot.PrincipalID, response.Snapshot.AuthorizationRev, response.SnapshotSHA, eventID)
	if err != nil {
		return false, fmt.Errorf("record authorization resync snapshot item: %w", err)
	}
	if command.RowsAffected() == 1 {
		return true, nil
	}
	var existingRevision int64
	var existingHash []byte
	var sourceEventID string
	if err := transaction.QueryRow(contextValue, `
		SELECT authz_revision, snapshot_sha256, source_event_id::text
		FROM authz.authorization_projection_resync_items
		WHERE resync_id = $1::uuid AND principal_id = $2::uuid
	`, response.ResyncID, response.Snapshot.PrincipalID).Scan(&existingRevision, &existingHash, &sourceEventID); err != nil {
		return false, fmt.Errorf("read duplicate authorization resync snapshot item: %w", err)
	}
	if existingRevision != response.Snapshot.AuthorizationRev || !equalBytes(existingHash, response.SnapshotSHA) || sourceEventID != eventID {
		return false, fmt.Errorf("authorization resync contains conflicting snapshots for one principal")
	}
	return false, nil
}

func applySnapshotPayload(contextValue context.Context, transaction pgx.Tx, payload snapshotPayload) error {
	grantsPayload, err := json.Marshal(payload.Grants)
	if err != nil {
		return fmt.Errorf("encode authorization snapshot grants: %w", err)
	}
	var applied bool
	if err := transaction.QueryRow(contextValue, `
		SELECT authz.apply_authorization_snapshot($1, $2, $3::jsonb)
	`, payload.PrincipalID, payload.AuthorizationRev, grantsPayload).Scan(&applied); err != nil {
		return err
	}
	_ = applied
	return nil
}

func recordResyncCompletion(
	contextValue context.Context,
	transaction pgx.Tx,
	eventID string,
	completion parsedResyncCompletion,
) error {
	var existingEventID string
	var existingCount *int
	var existingManifest []byte
	err := transaction.QueryRow(contextValue, `
		SELECT COALESCE(completion_event_id::text, ''), expected_snapshot_count, expected_manifest_sha256
		FROM authz.authorization_projection_resync_state
		WHERE singleton = true
	`).Scan(&existingEventID, &existingCount, &existingManifest)
	if err != nil {
		return fmt.Errorf("read authorization resync completion state: %w", err)
	}
	if existingCount != nil {
		if *existingCount != completion.SnapshotCount || !equalBytes(existingManifest, completion.ManifestSHA) {
			return fmt.Errorf("authorization resync completion conflicts with the recorded manifest")
		}
		if existingEventID != eventID {
			return fmt.Errorf("authorization resync completion was replayed with a different event ID")
		}
		return nil
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE authz.authorization_projection_resync_state
		SET completion_event_id = $1::uuid,
		    expected_snapshot_count = $2,
		    expected_manifest_sha256 = $3,
		    completed_at = clock_timestamp(),
		    last_error = NULL
		WHERE singleton = true
	`, eventID, completion.SnapshotCount, completion.ManifestSHA); err != nil {
		return fmt.Errorf("record authorization resync completion: %w", err)
	}
	return nil
}

func finalizeResync(contextValue context.Context, transaction pgx.Tx, resyncID string) error {
	var expectedCount *int
	var expectedManifest []byte
	var projectionReady bool
	err := transaction.QueryRow(contextValue, `
		SELECT expected_snapshot_count, expected_manifest_sha256, projection_ready
		FROM authz.authorization_projection_resync_state
		WHERE singleton = true AND active_resync_id = $1::uuid
	`, resyncID).Scan(&expectedCount, &expectedManifest, &projectionReady)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read authorization resync manifest state: %w", err)
	}
	if projectionReady || expectedCount == nil || expectedManifest == nil {
		return nil
	}
	rows, err := transaction.Query(contextValue, `
		SELECT principal_id::text, authz_revision, encode(snapshot_sha256, 'hex')
		FROM authz.authorization_projection_resync_items
		WHERE resync_id = $1::uuid
		ORDER BY principal_id
	`, resyncID)
	if err != nil {
		return fmt.Errorf("read authorization resync manifest items: %w", err)
	}
	defer rows.Close()
	items := make([]resyncManifestItem, 0, *expectedCount)
	for rows.Next() {
		var principalID string
		var revision int64
		var snapshotSHA string
		if err := rows.Scan(&principalID, &revision, &snapshotSHA); err != nil {
			return fmt.Errorf("scan authorization resync manifest item: %w", err)
		}
		items = append(items, resyncManifestItem{
			PrincipalID: principalID, Revision: revision, SnapshotSHA: snapshotSHA,
		})
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate authorization resync manifest items: %w", err)
	}
	ready, err := resyncManifestReady(*expectedCount, expectedManifest, items)
	if err != nil {
		return err
	}
	if !ready {
		return nil
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE authz.authorization_projection_resync_state
		SET projection_ready = true, completed_at = clock_timestamp(), last_error = NULL
		WHERE singleton = true AND active_resync_id = $1::uuid
	`, resyncID); err != nil {
		return fmt.Errorf("mark authorization projection resync ready: %w", err)
	}
	return nil
}

// resyncManifestReady is intentionally pure so its fail-closed completeness
// rule is covered without requiring a live PostgreSQL instance. It is used by
// finalizeResync after the target's transaction has read its durable items.
func resyncManifestReady(expectedCount int, expectedManifest []byte, items []resyncManifestItem) (bool, error) {
	if expectedCount < 0 || expectedCount > maximumResyncSnapshotCount || len(expectedManifest) != sha256.Size {
		return false, fmt.Errorf("authorization resync manifest expectation is invalid")
	}
	if len(items) < expectedCount {
		return false, nil
	}
	if len(items) > expectedCount {
		return false, fmt.Errorf("authorization resync received more snapshots than its manifest")
	}
	sortedItems := append([]resyncManifestItem(nil), items...)
	sort.Slice(sortedItems, func(first, second int) bool {
		return sortedItems[first].PrincipalID < sortedItems[second].PrincipalID
	})
	lines := make([]string, 0, len(sortedItems))
	for index, item := range sortedItems {
		if !validUUID(item.PrincipalID) || item.Revision <= 0 || !validSHA256Hex(item.SnapshotSHA) {
			return false, fmt.Errorf("authorization resync manifest item is invalid")
		}
		if index > 0 && sortedItems[index-1].PrincipalID == item.PrincipalID {
			return false, fmt.Errorf("authorization resync manifest contains a duplicate principal")
		}
		lines = append(lines, fmt.Sprintf("%s|%d|%s", item.PrincipalID, item.Revision, item.SnapshotSHA))
	}
	manifest := sha256.Sum256([]byte(strings.Join(lines, "\n")))
	if !equalBytes(manifest[:], expectedManifest) {
		return false, fmt.Errorf("authorization resync manifest does not match received snapshots")
	}
	return true, nil
}

func decodeStrictPayload(rawPayload []byte, target any) error {
	if len(rawPayload) == 0 || len(rawPayload) > maximumResyncPayloadBytes {
		return fmt.Errorf("payload size is invalid")
	}
	decoder := json.NewDecoder(strings.NewReader(string(rawPayload)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("exactly one JSON value is required")
	}
	return nil
}

func normalizeTargetService(rawTargetService string) (string, error) {
	targetService := strings.ToLower(strings.TrimSpace(rawTargetService))
	if !targetServicePattern.MatchString(targetService) {
		return "", fmt.Errorf("target service is invalid")
	}
	return targetService, nil
}

func validUUIDv7(value string) bool {
	parsed, err := uuid.Parse(strings.TrimSpace(value))
	return err == nil && strings.EqualFold(parsed.String(), strings.TrimSpace(value)) && parsed.Version() == uuid.Version(7)
}

func validSHA256Hex(value string) bool {
	if len(value) != sha256.Size*2 || strings.ToLower(value) != value {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size
}

func equalBytes(first, second []byte) bool {
	if len(first) != len(second) {
		return false
	}
	var difference byte
	for index := range first {
		difference |= first[index] ^ second[index]
	}
	return difference == 0
}

// ReadinessProbe reports the health of a dependency that can make the local
// authorization stream incomplete, normally the normal snapshot consumer,
// resync consumers, and outbox publisher.
type ReadinessProbe func(context.Context) error

// ResyncMonitor starts a bootstrap on process start and makes a new durable
// request after a consumer/broker failure or a bounded incomplete batch. The
// database gate is flipped by Start before any retry is sent, so application
// traffic cannot keep using a projection through an eight-day retention gap.
type ResyncMonitor struct {
	store        *ResyncStore
	logger       *slog.Logger
	probes       []ReadinessProbe
	pollInterval time.Duration
	retryAfter   time.Duration
	now          func() time.Time
	lastAttempt  time.Time
}

func NewResyncMonitor(store *ResyncStore, logger *slog.Logger, probes ...ReadinessProbe) (*ResyncMonitor, error) {
	if store == nil {
		return nil, fmt.Errorf("authorization resync store is required")
	}
	if logger == nil {
		return nil, fmt.Errorf("authorization resync monitor logger is required")
	}
	if len(probes) == 0 {
		return nil, fmt.Errorf("authorization resync monitor needs at least one readiness probe")
	}
	for _, probe := range probes {
		if probe == nil {
			return nil, fmt.Errorf("authorization resync monitor readiness probe is required")
		}
	}
	return &ResyncMonitor{
		store: store, logger: logger, probes: probes,
		pollInterval: 2 * time.Second, retryAfter: 2 * time.Minute, now: time.Now,
	}, nil
}

func (monitor *ResyncMonitor) Run(contextValue context.Context) {
	if monitor == nil {
		return
	}
	monitor.start(contextValue, "startup")
	ticker := time.NewTicker(monitor.pollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-contextValue.Done():
			return
		case <-ticker.C:
			monitor.reconcile(contextValue)
		}
	}
}

func (monitor *ResyncMonitor) reconcile(contextValue context.Context) {
	now := monitor.now().UTC()
	var unhealthy error
	for _, probe := range monitor.probes {
		if err := probe(contextValue); err != nil {
			unhealthy = err
			break
		}
	}
	status, statusErr := monitor.store.Status(contextValue)
	if unhealthy != nil || statusErr != nil {
		if monitor.lastAttempt.IsZero() || now.Sub(monitor.lastAttempt) >= monitor.retryAfter {
			monitor.start(contextValue, "consumer_recovery")
		}
		return
	}
	if !status.ProjectionReady && (status.RequestedAt.IsZero() || now.Sub(status.RequestedAt) >= monitor.retryAfter) {
		monitor.start(contextValue, "resync_timeout")
	}
}

func (monitor *ResyncMonitor) start(contextValue context.Context, reason string) {
	monitor.lastAttempt = monitor.now().UTC()
	if _, err := monitor.store.Start(contextValue, reason); err != nil {
		monitor.logger.Error("start authorization projection resync", "reason", reason, "error", err)
		return
	}
	monitor.logger.Info("requested authorization projection resync", "reason", reason)
}
