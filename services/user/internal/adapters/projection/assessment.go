package projection

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/messaging"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const assessmentCandidateAssignmentEvent = "assessment.candidate_assignment.snapshot.v1"

// AssessmentProjection materializes only opaque ownership facts needed by the
// canonical User authorization reader. A revoked snapshot becomes a durable
// tombstone, so stale active snapshots cannot re-grant candidate access.
type AssessmentProjection struct {
	pool *pgxpool.Pool
}

func NewAssessmentProjection(pool *pgxpool.Pool) (*AssessmentProjection, error) {
	if pool == nil {
		return nil, fmt.Errorf("user assessment projection database pool is required")
	}
	return &AssessmentProjection{pool: pool}, nil
}

func (projection *AssessmentProjection) Ping(ctx context.Context) error {
	if projection == nil || projection.pool == nil {
		return fmt.Errorf("user assessment projection is not initialized")
	}
	if err := projection.pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping User Assessment projection database: %w", err)
	}
	return nil
}

type assignmentSnapshot struct {
	TenantID              string                   `json:"tenant_id"`
	CandidateAssignmentID string                   `json:"candidate_assignment_id"`
	CandidateID           string                   `json:"candidate_id"`
	ExamID                string                   `json:"exam_id"`
	ExamVersionID         string                   `json:"exam_version_id"`
	AvailableFrom         string                   `json:"available_from"`
	AvailableUntil        string                   `json:"available_until"`
	AttemptLimit          int                      `json:"attempt_limit"`
	LifecycleState        string                   `json:"lifecycle_state"`
	Version               int64                    `json:"version"`
	Items                 []assignmentSnapshotItem `json:"items"`
}

type assignmentSnapshotItem struct {
	ExamItemID                string      `json:"exam_item_id"`
	EvaluationBundleObjectKey string      `json:"evaluation_bundle_object_key"`
	EvaluationBundleChecksum  string      `json:"evaluation_bundle_checksum"`
	MaximumScore              json.Number `json:"maximum_score"`
}

// Apply atomically claims, validates, and materializes a version-one snapshot.
// A malformed event is terminal: retrying cannot make its ownership facts
// trustworthy.
func (projection *AssessmentProjection) Apply(ctx context.Context, event messaging.Event) error {
	if projection == nil || projection.pool == nil {
		return fmt.Errorf("user assessment projection is not initialized")
	}
	payload, err := parseAssignmentSnapshot(event)
	if err != nil {
		return messaging.Permanent(err)
	}
	transaction, err := projection.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin Assessment projection transaction: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	payloadHash := sha256.Sum256(event.Payload)
	var claimedID string
	err = transaction.QueryRow(ctx, `
		INSERT INTO users.assessment_projection_inbox_messages (
			event_id, payload_sha256, occurred_at
		) VALUES ($1, $2, $3)
		ON CONFLICT (event_id) DO NOTHING
		RETURNING event_id::text
	`, event.ID, payloadHash[:], event.OccurredAt.UTC()).Scan(&claimedID)
	if errors.Is(err, pgx.ErrNoRows) {
		if commitErr := transaction.Commit(ctx); commitErr != nil {
			return fmt.Errorf("commit duplicate Assessment projection event: %w", commitErr)
		}
		return nil
	}
	if err != nil {
		return fmt.Errorf("claim Assessment projection event: %w", err)
	}
	_, err = transaction.Exec(ctx, `
		INSERT INTO users.candidate_assignment_projections (
			candidate_assignment_id, tenant_id, candidate_id, assignment_rule_id,
			exam_id, exam_version_id, lifecycle_state, version,
			source_event_id, source_occurred_at
		) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (candidate_assignment_id) DO UPDATE
		SET tenant_id = EXCLUDED.tenant_id,
			candidate_id = EXCLUDED.candidate_id,
			exam_id = EXCLUDED.exam_id,
			exam_version_id = EXCLUDED.exam_version_id,
			lifecycle_state = EXCLUDED.lifecycle_state,
			version = EXCLUDED.version,
			source_event_id = EXCLUDED.source_event_id,
			source_occurred_at = EXCLUDED.source_occurred_at,
			projected_at = clock_timestamp()
		WHERE EXCLUDED.version > users.candidate_assignment_projections.version
	`, payload.CandidateAssignmentID, payload.TenantID, payload.CandidateID,
		payload.ExamID, payload.ExamVersionID, payload.LifecycleState, payload.Version,
		event.ID, event.OccurredAt.UTC())
	if err != nil {
		return projectionWriteError(err, "apply Assessment candidate assignment projection")
	}
	if _, err := transaction.Exec(ctx, `
		UPDATE users.assessment_projection_inbox_messages
		SET processed_at = clock_timestamp(), last_error = NULL
		WHERE event_id = $1
	`, claimedID); err != nil {
		return fmt.Errorf("complete Assessment projection inbox event: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit Assessment projection event: %w", err)
	}
	return nil
}

func parseAssignmentSnapshot(event messaging.Event) (assignmentSnapshot, error) {
	if event.Type != assessmentCandidateAssignmentEvent || event.SchemaVersion != 1 || !validUUID(event.ID) {
		return assignmentSnapshot{}, fmt.Errorf("unsupported Assessment candidate assignment snapshot")
	}
	decoder := json.NewDecoder(strings.NewReader(string(event.Payload)))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	var payload assignmentSnapshot
	if err := decoder.Decode(&payload); err != nil {
		return assignmentSnapshot{}, fmt.Errorf("decode Assessment candidate assignment snapshot: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return assignmentSnapshot{}, fmt.Errorf("assessment candidate assignment snapshot must contain exactly one JSON value")
	}
	if !validUUID(payload.TenantID) || !validUUID(payload.CandidateAssignmentID) || !validUUID(payload.CandidateID) ||
		!validUUID(payload.ExamID) || !validUUID(payload.ExamVersionID) || payload.AttemptLimit < 1 || payload.AttemptLimit > 20 ||
		payload.Version < 1 || (payload.LifecycleState != "active" && payload.LifecycleState != "revoked") {
		return assignmentSnapshot{}, fmt.Errorf("assessment candidate assignment snapshot has invalid fields")
	}
	availableFrom, err := time.Parse(time.RFC3339Nano, payload.AvailableFrom)
	if err != nil {
		return assignmentSnapshot{}, fmt.Errorf("assessment snapshot available_from is invalid")
	}
	availableUntil, err := time.Parse(time.RFC3339Nano, payload.AvailableUntil)
	if err != nil || !availableUntil.After(availableFrom) {
		return assignmentSnapshot{}, fmt.Errorf("assessment snapshot availability window is invalid")
	}
	if payload.LifecycleState == "active" && len(payload.Items) == 0 {
		return assignmentSnapshot{}, fmt.Errorf("active Assessment snapshot requires evaluation items")
	}
	seenItems := make(map[string]struct{}, len(payload.Items))
	for _, item := range payload.Items {
		if !validUUID(item.ExamItemID) || strings.TrimSpace(item.EvaluationBundleObjectKey) == "" ||
			len(item.EvaluationBundleObjectKey) > 1024 || !checksum(item.EvaluationBundleChecksum) {
			return assignmentSnapshot{}, fmt.Errorf("assessment snapshot evaluation item is invalid")
		}
		if _, exists := seenItems[item.ExamItemID]; exists {
			return assignmentSnapshot{}, fmt.Errorf("assessment snapshot contains duplicate evaluation items")
		}
		seenItems[item.ExamItemID] = struct{}{}
		maximumScore, err := item.MaximumScore.Float64()
		if err != nil || math.IsNaN(maximumScore) || math.IsInf(maximumScore, 0) || maximumScore <= 0 {
			return assignmentSnapshot{}, fmt.Errorf("assessment snapshot maximum score is invalid")
		}
	}
	return payload, nil
}

func checksum(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) != 64 || value != strings.ToLower(value) {
		return false
	}
	for _, character := range value {
		//nolint:staticcheck // QF1001: the negated-range form reads more clearly for character validation
		if !(character >= '0' && character <= '9') && !(character >= 'a' && character <= 'f') {
			return false
		}
	}
	return true
}
