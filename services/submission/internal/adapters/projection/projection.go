// Package projection owns Submission's durable inbound event projections.
package projection

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/aethercode/aethercode/libs/pkg/messaging"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	AssignmentSnapshotEventType = "assessment.candidate_assignment.snapshot.v1"
	JudgeCompletedEventType     = "judge.completed.v1"
)

type Store struct {
	pool  *pgxpool.Pool
	inbox *messaging.InboxStore
}

func NewStore(pool *pgxpool.Pool) (*Store, error) {
	if pool == nil {
		return nil, fmt.Errorf("submission projection database pool is required")
	}
	inbox, err := messaging.NewInboxStore(pool, "app.inbox_messages")
	if err != nil {
		return nil, err
	}
	return &Store{pool: pool, inbox: inbox}, nil
}

func (store *Store) Ping(contextValue context.Context) error {
	if store == nil || store.pool == nil {
		return fmt.Errorf("submission projection store is not initialized")
	}
	if err := store.pool.Ping(contextValue); err != nil {
		return fmt.Errorf("ping Submission projection database: %w", err)
	}
	return nil
}

type assignmentItem struct {
	ExamItemID                string      `json:"exam_item_id"`
	EvaluationBundleObjectKey string      `json:"evaluation_bundle_object_key"`
	EvaluationBundleChecksum  string      `json:"evaluation_bundle_checksum"`
	MaximumScore              json.Number `json:"maximum_score"`
}

type assignmentSnapshot struct {
	TenantID              string           `json:"tenant_id"`
	CandidateAssignmentID string           `json:"candidate_assignment_id"`
	CandidateID           string           `json:"candidate_id"`
	ExamID                string           `json:"exam_id"`
	ExamVersionID         string           `json:"exam_version_id"`
	AvailableFrom         time.Time        `json:"available_from"`
	AvailableUntil        time.Time        `json:"available_until"`
	AttemptLimit          int16            `json:"attempt_limit"`
	LifecycleState        string           `json:"lifecycle_state"`
	Version               int64            `json:"version"`
	Items                 []assignmentItem `json:"items"`
}

// ApplyAssignmentSnapshot atomically materializes an Assessment-owned,
// immutable candidate assignment. The app role never gets projection-table
// privileges and candidate HTTP calls cannot forge bundle references.
func (store *Store) ApplyAssignmentSnapshot(contextValue context.Context, event messaging.Event) error {
	payload, err := parseAssignmentSnapshot(event)
	if err != nil {
		return messaging.Permanent(err)
	}
	items, err := json.Marshal(payload.Items)
	if err != nil {
		return fmt.Errorf("encode assignment snapshot items: %w", err)
	}
	_, err = store.inbox.Process(contextValue, "submission_assignment_snapshot_v1", event, func(
		applyContext context.Context,
		transaction pgx.Tx,
		_ messaging.Event,
	) error {
		var applied bool
		err := transaction.QueryRow(applyContext, `
			SELECT submission.apply_assignment_snapshot(
				$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb
			)
		`, event.ID, payload.TenantID, payload.CandidateAssignmentID, payload.CandidateID,
			payload.ExamID, payload.ExamVersionID, payload.AvailableFrom.UTC(), payload.AvailableUntil.UTC(),
			payload.AttemptLimit, payload.LifecycleState, payload.Version, string(items)).Scan(&applied)
		if err != nil {
			return projectionError(err, "apply assessment assignment snapshot")
		}
		_ = applied // A stale source snapshot is an idempotent no-op.
		return nil
	})
	if err != nil {
		return err
	}
	return nil
}

type judgeCompleted struct {
	TenantID               string    `json:"tenant_id"`
	EvaluationRequestID    string    `json:"evaluation_request_id"`
	JudgeJobID             string    `json:"judge_job_id"`
	JudgeEventID           string    `json:"judge_event_id"`
	Verdict                string    `json:"verdict"`
	ExecutionTimeMS        *int      `json:"execution_time_ms"`
	MemoryKiB              *int      `json:"memory_kib"`
	ResultObjectKey        *string   `json:"result_object_key"`
	ResultChecksum         *string   `json:"result_checksum"`
	EncryptionKeyReference *string   `json:"encryption_key_reference"`
	CompletedAt            time.Time `json:"completed_at"`
}

// ApplyJudgeCompletion preserves the wrapper receipt once, closes the matching
// evaluation request, and finalizes a score only after all work is terminal.
func (store *Store) ApplyJudgeCompletion(contextValue context.Context, event messaging.Event) error {
	payload, err := parseJudgeCompleted(event)
	if err != nil {
		return messaging.Permanent(err)
	}
	_, err = store.inbox.Process(contextValue, "submission_judge_completed_v1", event, func(
		applyContext context.Context,
		transaction pgx.Tx,
		_ messaging.Event,
	) error {
		receiptID, idErr := database.NewUUIDv7()
		if idErr != nil {
			return idErr
		}
		attemptEventID, idErr := database.NewUUIDv7()
		if idErr != nil {
			return idErr
		}
		scoreSummaryID, idErr := database.NewUUIDv7()
		if idErr != nil {
			return idErr
		}
		outboxEventID, idErr := database.NewUUIDv7()
		if idErr != nil {
			return idErr
		}
		var graded bool
		err := transaction.QueryRow(applyContext, `
			SELECT submission.record_judge_completion(
				$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
			)
		`, receiptID, attemptEventID, scoreSummaryID, outboxEventID, payload.TenantID,
			payload.EvaluationRequestID, payload.JudgeJobID, payload.JudgeEventID, payload.Verdict,
			payload.ExecutionTimeMS, payload.MemoryKiB, nullableString(payload.ResultObjectKey),
			nullableString(payload.ResultChecksum), nullableString(payload.EncryptionKeyReference),
			payload.CompletedAt.UTC()).Scan(&graded)
		if err != nil {
			return projectionError(err, "record Judge completion")
		}
		_ = graded // Non-final and duplicate completions are both successful inbox applications.
		return nil
	})
	if err != nil {
		return err
	}
	return nil
}

func parseAssignmentSnapshot(event messaging.Event) (assignmentSnapshot, error) {
	if event.Type != AssignmentSnapshotEventType || event.SchemaVersion != 1 {
		return assignmentSnapshot{}, fmt.Errorf("unsupported assessment assignment snapshot event")
	}
	var payload assignmentSnapshot
	if err := decodePayload(event.Payload, &payload); err != nil {
		return assignmentSnapshot{}, fmt.Errorf("decode assessment assignment snapshot: %w", err)
	}
	if !sameUUID(payload.TenantID, event.TenantID) || !validUUID(event.ID) || !validUUID(payload.CandidateAssignmentID) ||
		!validUUID(payload.CandidateID) || !validUUID(payload.ExamID) || !validUUID(payload.ExamVersionID) ||
		payload.AvailableFrom.IsZero() || payload.AvailableUntil.IsZero() || !payload.AvailableFrom.Before(payload.AvailableUntil) ||
		payload.AttemptLimit < 1 || payload.AttemptLimit > 20 || payload.Version <= 0 ||
		(payload.LifecycleState != "active" && payload.LifecycleState != "revoked") ||
		(payload.LifecycleState == "active" && len(payload.Items) == 0) {
		return assignmentSnapshot{}, fmt.Errorf("assessment assignment snapshot fields are invalid")
	}
	seenItems := make(map[string]struct{}, len(payload.Items))
	for _, item := range payload.Items {
		maximumScore, parseErr := strconv.ParseFloat(item.MaximumScore.String(), 64)
		if !validUUID(item.ExamItemID) || strings.TrimSpace(item.EvaluationBundleObjectKey) == "" ||
			!validSHA256(item.EvaluationBundleChecksum) || parseErr != nil || maximumScore <= 0 {
			return assignmentSnapshot{}, fmt.Errorf("assessment assignment item is invalid")
		}
		if _, duplicate := seenItems[item.ExamItemID]; duplicate {
			return assignmentSnapshot{}, fmt.Errorf("assessment assignment contains a duplicate exam item")
		}
		seenItems[item.ExamItemID] = struct{}{}
	}
	return payload, nil
}

func parseJudgeCompleted(event messaging.Event) (judgeCompleted, error) {
	if event.Type != JudgeCompletedEventType || event.SchemaVersion != 1 {
		return judgeCompleted{}, fmt.Errorf("unsupported Judge completion event")
	}
	var payload judgeCompleted
	if err := decodePayload(event.Payload, &payload); err != nil {
		return judgeCompleted{}, fmt.Errorf("decode Judge completion: %w", err)
	}
	if !sameUUID(payload.TenantID, event.TenantID) || !validUUID(event.ID) || !validUUID(payload.EvaluationRequestID) ||
		!validUUID(payload.JudgeJobID) || !validUUID(payload.JudgeEventID) ||
		payload.CompletedAt.IsZero() || !payload.CompletedAt.Equal(event.OccurredAt) ||
		!validVerdict(payload.Verdict) || (payload.ExecutionTimeMS != nil && *payload.ExecutionTimeMS < 0) ||
		(payload.MemoryKiB != nil && *payload.MemoryKiB < 0) ||
		!sameOptionalPresence(payload.ResultObjectKey, payload.ResultChecksum, payload.EncryptionKeyReference) ||
		(payload.ResultChecksum != nil && !validSHA256(*payload.ResultChecksum)) ||
		(payload.ResultObjectKey != nil && strings.TrimSpace(*payload.ResultObjectKey) == "") ||
		(payload.EncryptionKeyReference != nil && strings.TrimSpace(*payload.EncryptionKeyReference) == "") {
		return judgeCompleted{}, fmt.Errorf("judge completion fields are invalid")
	}
	return payload, nil
}

func decodePayload(raw json.RawMessage, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("payload must contain one JSON value")
	}
	return nil
}

func nullableString(value *string) any {
	if value == nil {
		return nil
	}
	return strings.TrimSpace(*value)
}

func sameOptionalPresence(values ...*string) bool {
	if len(values) == 0 {
		return true
	}
	present := values[0] != nil
	for _, value := range values[1:] {
		if (value != nil) != present {
			return false
		}
	}
	return true
}

func validVerdict(value string) bool {
	switch value {
	case "accepted", "wrong_answer", "time_limit_exceeded", "memory_limit_exceeded", "runtime_error", "compile_error", "internal_error", "cancelled":
		return true
	default:
		return false
	}
}

func validUUID(value string) bool {
	parsed, err := uuid.Parse(strings.TrimSpace(value))
	return err == nil && strings.EqualFold(parsed.String(), strings.TrimSpace(value))
}

func sameUUID(left, right string) bool {
	return validUUID(left) && validUUID(right) && strings.EqualFold(strings.TrimSpace(left), strings.TrimSpace(right))
}

func validSHA256(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) != 64 {
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

func projectionError(err error, operation string) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && (postgresError.Code == "P0001" || postgresError.Code == "22P02" || postgresError.Code == "23514" || postgresError.Code == "22023") {
		return messaging.Permanent(fmt.Errorf("%s: %w", operation, err))
	}
	return fmt.Errorf("%s: %w", operation, err)
}
