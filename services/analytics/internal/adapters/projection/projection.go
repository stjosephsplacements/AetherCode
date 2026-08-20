// Package projection applies versioned platform events to Analytics' local
// read models. It never makes cross-service database calls.
package projection

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/aethercode/aethercode/libs/pkg/messaging"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	StudentEnrolledEventType         = "user.student.enrolled.v1"
	StudentBatchAffiliationEventType = "user.student_batch_affiliation.snapshot.v1"
	ExamItemCreatedEventType         = "assessment.exam_item.created.v1"
	AssignmentSnapshotEventType      = "assessment.candidate_assignment.snapshot.v1"
	EvaluationRequestedEventType     = "submission.evaluation_requested.v1"
	JudgeCompletedEventType          = "judge.completed.v1"
	AttemptStartedEventType          = "submission.attempt_started.v1"
	AttemptSubmittedEventType        = "submission.attempt_submitted.v1"
	AttemptGradedEventType           = "submission.attempt_graded.v1"
	AttemptCancelledEventType        = "submission.attempt_cancelled.v1"
	LegalHoldPlacedEventType         = "tenant.legal_hold.placed.v1"
	LegalHoldReleasedEventType       = "tenant.legal_hold.released.v1"
	RetentionPolicyUpdatedEventType  = "tenant.retention_policy.updated.v1"
)

type Store struct {
	pool  *pgxpool.Pool
	inbox *messaging.InboxStore
}

func NewStore(pool *pgxpool.Pool) (*Store, error) {
	if pool == nil {
		return nil, fmt.Errorf("analytics projection database pool is required")
	}
	inbox, err := messaging.NewInboxStore(pool, "app.inbox_messages")
	if err != nil {
		return nil, err
	}
	return &Store{pool: pool, inbox: inbox}, nil
}

func (store *Store) Ping(ctx context.Context) error {
	if store == nil || store.pool == nil {
		return fmt.Errorf("analytics projection store is not initialized")
	}
	if err := store.pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping Analytics projection database: %w", err)
	}
	return nil
}

type studentEnrolled struct {
	StudentID             string `json:"student_id"`
	PrincipalID           string `json:"principal_id"`
	TenantID              string `json:"tenant_id"`
	CollegeDepartmentID   string `json:"college_department_id"`
	PlacementDepartmentID string `json:"placement_department_id"`
}

func (store *Store) ApplyStudentEnrolled(ctx context.Context, event messaging.Event) error {
	var payload studentEnrolled
	if err := decodeEvent(event, StudentEnrolledEventType, &payload); err != nil ||
		!sameUUID(payload.TenantID, event.TenantID) || !validUUID(payload.StudentID) ||
		!validUUID(payload.PrincipalID) || !validUUID(payload.CollegeDepartmentID) || !validUUID(payload.PlacementDepartmentID) {
		return permanent("student enrollment event is invalid", err)
	}
	return store.process(ctx, "analytics_student_enrolled_v1", event, func(tx pgx.Tx) error {
		if err := store.recordEventFact(ctx, tx, event); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO analytics.student_affiliation_projections (
				tenant_id, student_id, college_department_id, placement_department_id,
				source_event_id, source_occurred_at
			) VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (tenant_id, student_id) DO UPDATE
			SET college_department_id = EXCLUDED.college_department_id,
				placement_department_id = EXCLUDED.placement_department_id,
				source_event_id = EXCLUDED.source_event_id,
				source_occurred_at = EXCLUDED.source_occurred_at,
				updated_at = clock_timestamp()
			WHERE EXCLUDED.source_occurred_at >= analytics.student_affiliation_projections.source_occurred_at
		`, payload.TenantID, payload.StudentID, payload.CollegeDepartmentID, payload.PlacementDepartmentID,
			event.ID, event.OccurredAt.UTC())
		if err != nil {
			return projectionError(err, "upsert student affiliation")
		}
		if _, err := tx.Exec(ctx, `SELECT analytics.rebuild_student_placement($1, $2)`, payload.TenantID, payload.StudentID); err != nil {
			return projectionError(err, "rebuild student placement")
		}
		return nil
	})
}

// studentBatchAffiliationSnapshot is User's authoritative current-membership
// view. Analytics normalizes inactive snapshots to no current batch, even when
// the producer includes a prior batch identifier for audit context.
type studentBatchAffiliationSnapshot struct {
	TenantID       string  `json:"tenant_id"`
	StudentID      string  `json:"student_id"`
	BatchID        *string `json:"batch_id"`
	LifecycleState string  `json:"lifecycle_state"`
	Version        int64   `json:"version"`
}

func (store *Store) ApplyStudentBatchAffiliationSnapshot(ctx context.Context, event messaging.Event) error {
	payload, err := decodeStudentBatchAffiliationSnapshot(event)
	if err != nil {
		return permanent("student batch affiliation snapshot is invalid", err)
	}
	return store.process(ctx, "analytics_student_batch_affiliation_snapshot_v1", event, func(tx pgx.Tx) error {
		if err := store.recordEventFact(ctx, tx, event); err != nil {
			return err
		}
		var applied bool
		var previousBatchID string
		var currentBatchID string
		var batchID any
		if payload.BatchID != nil {
			batchID = *payload.BatchID
		}
		err := tx.QueryRow(ctx, `
			SELECT applied,
				COALESCE(previous_batch_id::text, ''),
				COALESCE(current_batch_id::text, '')
			FROM analytics.apply_student_batch_affiliation_snapshot(
				$1::uuid, $2::uuid, $3::uuid, $4::text, $5::bigint, $6::uuid, $7::timestamptz
			)
		`, payload.TenantID, payload.StudentID, batchID, payload.LifecycleState, payload.Version,
			event.ID, event.OccurredAt.UTC()).Scan(&applied, &previousBatchID, &currentBatchID)
		if err != nil {
			return projectionError(err, "apply student batch affiliation")
		}
		if !applied {
			return nil
		}

		batches := make([]string, 0, 2)
		if validUUID(previousBatchID) {
			batches = append(batches, previousBatchID)
		}
		if validUUID(currentBatchID) && (len(batches) == 0 || !sameUUID(previousBatchID, currentBatchID)) {
			batches = append(batches, currentBatchID)
		}
		sort.Strings(batches)
		for _, affectedBatchID := range batches {
			if err := store.rebuildBatchProgress(ctx, tx, payload.TenantID, affectedBatchID); err != nil {
				return err
			}
		}
		return nil
	})
}

type examItemCreated struct {
	ExamItemID        string `json:"exam_item_id"`
	ExamVersionID     string `json:"exam_version_id"`
	SectionID         string `json:"section_id"`
	QuestionID        string `json:"question_id"`
	QuestionVersionID string `json:"question_version_id"`
	TenantID          string `json:"tenant_id"`
}

func (store *Store) ApplyExamItemCreated(ctx context.Context, event messaging.Event) error {
	var payload examItemCreated
	if err := decodeEvent(event, ExamItemCreatedEventType, &payload); err != nil ||
		!sameUUID(payload.TenantID, event.TenantID) || !validUUID(payload.ExamItemID) ||
		!validUUID(payload.ExamVersionID) || !validUUID(payload.SectionID) ||
		!validUUID(payload.QuestionID) || !validUUID(payload.QuestionVersionID) {
		return permanent("exam item event is invalid", err)
	}
	return store.process(ctx, "analytics_exam_item_created_v1", event, func(tx pgx.Tx) error {
		if err := store.recordEventFact(ctx, tx, event); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO analytics.exam_item_projections (
				tenant_id, exam_item_id, exam_version_id, question_id, question_version_id,
				source_event_id, source_occurred_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (tenant_id, exam_item_id) DO UPDATE
			SET exam_version_id = EXCLUDED.exam_version_id, question_id = EXCLUDED.question_id,
				question_version_id = EXCLUDED.question_version_id, source_event_id = EXCLUDED.source_event_id,
				source_occurred_at = EXCLUDED.source_occurred_at, updated_at = clock_timestamp()
			WHERE EXCLUDED.source_occurred_at >= analytics.exam_item_projections.source_occurred_at
		`, payload.TenantID, payload.ExamItemID, payload.ExamVersionID, payload.QuestionID,
			payload.QuestionVersionID, event.ID, event.OccurredAt.UTC())
		if err != nil {
			return projectionError(err, "upsert exam item projection")
		}
		rows, err := tx.Query(ctx, `
			SELECT DISTINCT attempt_id::text
			FROM analytics.evaluation_projections
			WHERE tenant_id = $1 AND exam_item_id = $2
		`, payload.TenantID, payload.ExamItemID)
		if err != nil {
			return projectionError(err, "find affected attempts")
		}
		attemptIDs := make([]string, 0)
		for rows.Next() {
			var attemptID string
			if err := rows.Scan(&attemptID); err != nil {
				rows.Close()
				return fmt.Errorf("scan affected attempt: %w", err)
			}
			attemptIDs = append(attemptIDs, attemptID)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		for _, attemptID := range attemptIDs {
			if _, err := tx.Exec(ctx, `SELECT analytics.rebuild_attempt_rollups($1, $2)`, payload.TenantID, attemptID); err != nil {
				return projectionError(err, "rebuild exam-item attempt")
			}
		}
		return nil
	})
}

type assignmentSnapshot struct {
	TenantID              string           `json:"tenant_id"`
	CandidateAssignmentID string           `json:"candidate_assignment_id"`
	CandidateID           string           `json:"candidate_id"`
	ExamID                string           `json:"exam_id"`
	ExamVersionID         string           `json:"exam_version_id"`
	AvailableFrom         time.Time        `json:"available_from"`
	AvailableUntil        time.Time        `json:"available_until"`
	AttemptLimit          int              `json:"attempt_limit"`
	LifecycleState        string           `json:"lifecycle_state"`
	Version               int64            `json:"version"`
	Items                 []assignmentItem `json:"items"`
}

type assignmentItem struct {
	ExamItemID                string      `json:"exam_item_id"`
	EvaluationBundleObjectKey string      `json:"evaluation_bundle_object_key"`
	EvaluationBundleChecksum  string      `json:"evaluation_bundle_checksum"`
	MaximumScore              json.Number `json:"maximum_score"`
}

func (store *Store) ApplyAssignmentSnapshot(ctx context.Context, event messaging.Event) error {
	var payload assignmentSnapshot
	if err := decodeEvent(event, AssignmentSnapshotEventType, &payload); err != nil ||
		!sameUUID(payload.TenantID, event.TenantID) || !validUUID(payload.CandidateAssignmentID) ||
		!validUUID(payload.CandidateID) || !validUUID(payload.ExamID) || !validUUID(payload.ExamVersionID) ||
		payload.AvailableFrom.IsZero() || payload.AvailableUntil.IsZero() || !payload.AvailableFrom.Before(payload.AvailableUntil) ||
		payload.AttemptLimit < 1 || payload.AttemptLimit > 20 || payload.Version <= 0 ||
		(payload.LifecycleState != "active" && payload.LifecycleState != "revoked") ||
		(payload.LifecycleState == "active" && len(payload.Items) == 0) || !validAssignmentItems(payload.Items) {
		return permanent("candidate assignment snapshot is invalid", err)
	}
	return store.process(ctx, "analytics_assignment_snapshot_v1", event, func(tx pgx.Tx) error {
		if err := store.recordEventFact(ctx, tx, event); err != nil {
			return err
		}
		var previousCandidateID string
		previousCandidateErr := tx.QueryRow(ctx, `
			SELECT candidate_id::text
			FROM analytics.candidate_assignment_projections
			WHERE tenant_id = $1 AND candidate_assignment_id = $2
		`, payload.TenantID, payload.CandidateAssignmentID).Scan(&previousCandidateID)
		if previousCandidateErr != nil && !errors.Is(previousCandidateErr, pgx.ErrNoRows) {
			return projectionError(previousCandidateErr, "find previous assignment candidate")
		}
		applied, err := tx.Exec(ctx, `
			INSERT INTO analytics.candidate_assignment_projections (
				tenant_id, candidate_assignment_id, candidate_id, exam_id, exam_version_id,
				available_from, available_until, lifecycle_state, source_revision,
				source_event_id, source_occurred_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			ON CONFLICT (tenant_id, candidate_assignment_id) DO UPDATE
			SET candidate_id = EXCLUDED.candidate_id, exam_id = EXCLUDED.exam_id,
				exam_version_id = EXCLUDED.exam_version_id, available_from = EXCLUDED.available_from,
				available_until = EXCLUDED.available_until, lifecycle_state = EXCLUDED.lifecycle_state,
				source_revision = EXCLUDED.source_revision, source_event_id = EXCLUDED.source_event_id,
				source_occurred_at = EXCLUDED.source_occurred_at, updated_at = clock_timestamp()
			WHERE EXCLUDED.source_revision >= analytics.candidate_assignment_projections.source_revision
		`, payload.TenantID, payload.CandidateAssignmentID, payload.CandidateID, payload.ExamID,
			payload.ExamVersionID, payload.AvailableFrom.UTC(), payload.AvailableUntil.UTC(),
			payload.LifecycleState, payload.Version, event.ID, event.OccurredAt.UTC())
		if err != nil {
			return projectionError(err, "upsert candidate assignment projection")
		}
		if applied.RowsAffected() == 0 {
			return nil
		}
		if err := store.rebuildStudentBatchProgress(ctx, tx, payload.TenantID, previousCandidateID, payload.CandidateID); err != nil {
			return err
		}
		return nil
	})
}

type evaluationRequested struct {
	EvaluationRequestID       string      `json:"evaluation_request_id"`
	AttemptID                 string      `json:"attempt_id"`
	AnswerRevisionID          string      `json:"answer_revision_id"`
	ExamItemID                string      `json:"exam_item_id"`
	EvaluationBundleObjectKey string      `json:"evaluation_bundle_object_key"`
	EvaluationBundleChecksum  string      `json:"evaluation_bundle_checksum"`
	MaximumScore              json.Number `json:"maximum_score"`
	CallerIdempotencyKey      string      `json:"caller_idempotency_key"`
}

func (store *Store) ApplyEvaluationRequested(ctx context.Context, event messaging.Event) error {
	var payload evaluationRequested
	if err := decodeEvent(event, EvaluationRequestedEventType, &payload); err != nil ||
		!validTenantEvent(event) || !validUUID(payload.EvaluationRequestID) || !validUUID(payload.AttemptID) ||
		!validUUID(payload.AnswerRevisionID) || !validUUID(payload.ExamItemID) ||
		strings.TrimSpace(payload.EvaluationBundleObjectKey) == "" || !validSHA256(payload.EvaluationBundleChecksum) ||
		!positiveNumber(payload.MaximumScore) || strings.TrimSpace(payload.CallerIdempotencyKey) == "" || len(payload.CallerIdempotencyKey) > 255 {
		return permanent("evaluation request event is invalid", err)
	}
	return store.process(ctx, "analytics_evaluation_requested_v1", event, func(tx pgx.Tx) error {
		if err := store.recordEventFact(ctx, tx, event); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO analytics.evaluation_projections (
				tenant_id, evaluation_request_id, attempt_id, answer_revision_id, exam_item_id,
				maximum_score, requested_event_id, requested_at
			) VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8)
			ON CONFLICT (tenant_id, evaluation_request_id) DO UPDATE
			SET attempt_id = EXCLUDED.attempt_id, answer_revision_id = EXCLUDED.answer_revision_id,
				exam_item_id = EXCLUDED.exam_item_id, maximum_score = EXCLUDED.maximum_score,
				requested_event_id = EXCLUDED.requested_event_id, requested_at = EXCLUDED.requested_at,
				updated_at = clock_timestamp()
			WHERE EXCLUDED.requested_at >= analytics.evaluation_projections.requested_at
		`, event.TenantID, payload.EvaluationRequestID, payload.AttemptID, payload.AnswerRevisionID,
			payload.ExamItemID, payload.MaximumScore.String(), event.ID, event.OccurredAt.UTC())
		if err != nil {
			return projectionError(err, "upsert evaluation projection")
		}
		if err := store.applyStoredJudgeCompletion(ctx, tx, event.TenantID, payload.EvaluationRequestID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `SELECT analytics.rebuild_attempt_rollups($1, $2)`, event.TenantID, payload.AttemptID); err != nil {
			return projectionError(err, "rebuild evaluation attempt")
		}
		return nil
	})
}

type judgeCompleted struct {
	TenantID               string  `json:"tenant_id"`
	EvaluationRequestID    string  `json:"evaluation_request_id"`
	JudgeJobID             string  `json:"judge_job_id"`
	JudgeEventID           string  `json:"judge_event_id"`
	Verdict                string  `json:"verdict"`
	ExecutionTimeMS        *int    `json:"execution_time_ms"`
	MemoryKiB              *int    `json:"memory_kib"`
	ResultObjectKey        *string `json:"result_object_key"`
	ResultChecksum         *string `json:"result_checksum"`
	EncryptionKeyReference *string `json:"encryption_key_reference"`
}

func (store *Store) ApplyJudgeCompleted(ctx context.Context, event messaging.Event) error {
	var payload judgeCompleted
	if err := decodeEvent(event, JudgeCompletedEventType, &payload); err != nil ||
		!sameUUID(payload.TenantID, event.TenantID) || !validUUID(payload.EvaluationRequestID) ||
		!validUUID(payload.JudgeJobID) || !validUUID(payload.JudgeEventID) || !validVerdict(payload.Verdict) ||
		(payload.ExecutionTimeMS != nil && *payload.ExecutionTimeMS < 0) ||
		(payload.MemoryKiB != nil && *payload.MemoryKiB < 0) ||
		!sameOptionalPresence(payload.ResultObjectKey, payload.ResultChecksum, payload.EncryptionKeyReference) ||
		(payload.ResultChecksum != nil && !validSHA256(*payload.ResultChecksum)) ||
		(payload.ResultObjectKey != nil && strings.TrimSpace(*payload.ResultObjectKey) == "") ||
		(payload.EncryptionKeyReference != nil && strings.TrimSpace(*payload.EncryptionKeyReference) == "") {
		return permanent("Judge completion event is invalid", err)
	}
	return store.process(ctx, "analytics_judge_completed_v1", event, func(tx pgx.Tx) error {
		if err := store.recordEventFact(ctx, tx, event); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO analytics.judge_completion_projections (
				tenant_id, evaluation_request_id, verdict, source_event_id, completed_at
			) VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (tenant_id, evaluation_request_id) DO UPDATE
			SET verdict = EXCLUDED.verdict, source_event_id = EXCLUDED.source_event_id,
				completed_at = EXCLUDED.completed_at, updated_at = clock_timestamp()
			WHERE EXCLUDED.completed_at >= analytics.judge_completion_projections.completed_at
		`, payload.TenantID, payload.EvaluationRequestID, payload.Verdict, event.ID, event.OccurredAt.UTC())
		if err != nil {
			return projectionError(err, "upsert Judge completion projection")
		}
		return store.applyStoredJudgeCompletion(ctx, tx, payload.TenantID, payload.EvaluationRequestID)
	})
}

func (store *Store) applyStoredJudgeCompletion(ctx context.Context, tx pgx.Tx, tenantID, evaluationRequestID string) error {
	var attemptID string
	err := tx.QueryRow(ctx, `
		UPDATE analytics.evaluation_projections AS evaluation
		SET verdict = completion.verdict, completion_event_id = completion.source_event_id,
			completed_at = completion.completed_at, updated_at = clock_timestamp()
		FROM analytics.judge_completion_projections AS completion
		WHERE evaluation.tenant_id = $1
		  AND evaluation.evaluation_request_id = $2
		  AND completion.tenant_id = evaluation.tenant_id
		  AND completion.evaluation_request_id = evaluation.evaluation_request_id
		  AND (evaluation.completed_at IS NULL OR completion.completed_at >= evaluation.completed_at)
		RETURNING evaluation.attempt_id::text
	`, tenantID, evaluationRequestID).Scan(&attemptID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return projectionError(err, "apply Judge completion")
	}
	if _, err := tx.Exec(ctx, `SELECT analytics.rebuild_attempt_rollups($1, $2)`, tenantID, attemptID); err != nil {
		return projectionError(err, "rebuild completed attempt")
	}
	return nil
}

// attemptStarted is the single safe fact emitted when Submission creates an
// assignment-backed attempt. It deliberately contains no answer, object-store,
// or Judge metadata.
type attemptStarted struct {
	AttemptID             string    `json:"attempt_id"`
	TenantID              string    `json:"tenant_id"`
	CandidateAssignmentID string    `json:"candidate_assignment_id"`
	CandidateID           string    `json:"candidate_id"`
	ExamID                string    `json:"exam_id"`
	ExamVersionID         string    `json:"exam_version_id"`
	StartedAt             time.Time `json:"started_at"`
}

// ApplyAttemptStarted retains a first immutable start fact and rebuilds only
// the candidate's current batch. A terminal grade is also treated as proof of
// a start in the SQL rollup, so delivery across separate JetStream subjects is
// order-independent without fabricating nonterminal activity.
func (store *Store) ApplyAttemptStarted(ctx context.Context, event messaging.Event) error {
	payload, err := decodeAttemptStarted(event)
	if err != nil {
		return permanent("attempt started event is invalid", err)
	}
	return store.process(ctx, "analytics_attempt_started_v1", event, func(tx pgx.Tx) error {
		if err := store.recordEventFact(ctx, tx, event); err != nil {
			return err
		}
		applied, err := tx.Exec(ctx, `
			INSERT INTO analytics.attempt_started_projections (
				tenant_id, attempt_id, candidate_assignment_id, candidate_id, exam_id,
				exam_version_id, started_at, source_event_id, source_occurred_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			ON CONFLICT (tenant_id, attempt_id) DO NOTHING
		`, payload.TenantID, payload.AttemptID, payload.CandidateAssignmentID,
			payload.CandidateID, payload.ExamID, payload.ExamVersionID, payload.StartedAt.UTC(),
			event.ID, event.OccurredAt.UTC())
		if err != nil {
			return projectionError(err, "insert attempt started projection")
		}
		if applied.RowsAffected() == 0 {
			return nil
		}
		return store.rebuildStudentBatchProgress(ctx, tx, payload.TenantID, payload.CandidateID)
	})
}

func decodeAttemptStarted(event messaging.Event) (attemptStarted, error) {
	var payload attemptStarted
	if err := decodeEvent(event, AttemptStartedEventType, &payload); err != nil {
		return attemptStarted{}, err
	}
	if !validTenantEvent(event) || event.AggregateType != "attempt" ||
		!sameUUID(event.AggregateID, payload.AttemptID) || !sameUUID(payload.TenantID, event.TenantID) ||
		!validUUID(payload.AttemptID) || !validUUID(payload.CandidateAssignmentID) ||
		!validUUID(payload.CandidateID) || !validUUID(payload.ExamID) ||
		!validUUID(payload.ExamVersionID) || payload.StartedAt.IsZero() {
		return attemptStarted{}, fmt.Errorf("attempt started event fields are invalid")
	}
	return payload, nil
}

type attemptSubmitted struct {
	AttemptID              string    `json:"attempt_id"`
	TenantID               string    `json:"tenant_id"`
	CandidateAssignmentID  string    `json:"candidate_assignment_id"`
	CandidateID            string    `json:"candidate_id"`
	ExamID                 string    `json:"exam_id"`
	ExamVersionID          string    `json:"exam_version_id"`
	EvaluationRequestCount int       `json:"evaluation_request_count"`
	SubmittedAt            time.Time `json:"submitted_at"`
}

func (store *Store) ApplyAttemptSubmitted(ctx context.Context, event messaging.Event) error {
	var payload attemptSubmitted
	if err := decodeEvent(event, AttemptSubmittedEventType, &payload); err != nil ||
		!validTenantEvent(event) || event.AggregateType != "attempt" ||
		!sameUUID(event.AggregateID, payload.AttemptID) || !sameUUID(payload.TenantID, event.TenantID) ||
		!validUUID(payload.AttemptID) || !validUUID(payload.CandidateAssignmentID) ||
		!validUUID(payload.CandidateID) || !validUUID(payload.ExamID) ||
		!validUUID(payload.ExamVersionID) || payload.EvaluationRequestCount < 0 ||
		payload.SubmittedAt.IsZero() {
		return permanent("attempt submitted event is invalid", err)
	}
	return store.process(ctx, "analytics_attempt_submitted_v1", event, func(tx pgx.Tx) error {
		if err := store.recordEventFact(ctx, tx, event); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `SELECT analytics.apply_attempt_submitted($1, $2, $3, $4, $5)`,
			event.ID, payload.TenantID, payload.AttemptID, payload.CandidateID, payload.SubmittedAt.UTC()); err != nil {
			return projectionError(err, "apply attempt submitted")
		}
		return nil
	})
}

type attemptGraded struct {
	AttemptID             string      `json:"attempt_id"`
	TenantID              string      `json:"tenant_id"`
	CandidateAssignmentID string      `json:"candidate_assignment_id"`
	CandidateID           string      `json:"candidate_id"`
	ExamID                string      `json:"exam_id"`
	ExamVersionID         string      `json:"exam_version_id"`
	AttemptNumber         int         `json:"attempt_number"`
	LifecycleState        string      `json:"lifecycle_state"`
	Score                 json.Number `json:"score"`
	MaximumScore          json.Number `json:"maximum_score"`
	CompletedAt           time.Time   `json:"completed_at"`
}

func (store *Store) ApplyAttemptGraded(ctx context.Context, event messaging.Event) error {
	var payload attemptGraded
	if err := decodeEvent(event, AttemptGradedEventType, &payload); err != nil ||
		!sameUUID(payload.TenantID, event.TenantID) || !validUUID(payload.AttemptID) ||
		!validUUID(payload.CandidateAssignmentID) || !validUUID(payload.CandidateID) ||
		!validUUID(payload.ExamID) || !validUUID(payload.ExamVersionID) ||
		payload.AttemptNumber < 1 || payload.AttemptNumber > 20 || payload.LifecycleState != "graded" ||
		!nonNegativeNumber(payload.Score) || !positiveNumber(payload.MaximumScore) ||
		!scoreWithinMaximum(payload.Score, payload.MaximumScore) || payload.CompletedAt.IsZero() {
		return permanent("graded attempt event is invalid", err)
	}
	return store.process(ctx, "analytics_attempt_graded_v1", event, func(tx pgx.Tx) error {
		if err := store.recordEventFact(ctx, tx, event); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO analytics.attempt_projections (
				tenant_id, attempt_id, candidate_assignment_id, candidate_id, exam_id,
				exam_version_id, attempt_number, lifecycle_state, score, maximum_score,
				completed_at, source_event_id, source_occurred_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10::numeric, $11, $12, $13)
			ON CONFLICT (tenant_id, attempt_id) DO UPDATE
			SET candidate_assignment_id = EXCLUDED.candidate_assignment_id,
				candidate_id = EXCLUDED.candidate_id, exam_id = EXCLUDED.exam_id,
				exam_version_id = EXCLUDED.exam_version_id, attempt_number = EXCLUDED.attempt_number,
				lifecycle_state = EXCLUDED.lifecycle_state, score = EXCLUDED.score,
				maximum_score = EXCLUDED.maximum_score, completed_at = EXCLUDED.completed_at,
				source_event_id = EXCLUDED.source_event_id,
				source_occurred_at = EXCLUDED.source_occurred_at, updated_at = clock_timestamp()
			WHERE EXCLUDED.source_occurred_at >= analytics.attempt_projections.source_occurred_at
		`, payload.TenantID, payload.AttemptID, payload.CandidateAssignmentID, payload.CandidateID,
			payload.ExamID, payload.ExamVersionID, payload.AttemptNumber, payload.LifecycleState,
			payload.Score.String(), payload.MaximumScore.String(), payload.CompletedAt.UTC(), event.ID, event.OccurredAt.UTC())
		if err != nil {
			return projectionError(err, "upsert graded attempt")
		}
		if _, err := tx.Exec(ctx, `SELECT analytics.rebuild_attempt_rollups($1, $2)`, payload.TenantID, payload.AttemptID); err != nil {
			return projectionError(err, "rebuild graded attempt")
		}
		if err := store.rebuildStudentBatchProgress(ctx, tx, payload.TenantID, payload.CandidateID); err != nil {
			return err
		}
		return nil
	})
}

type attemptCancelled struct {
	AttemptID                 string    `json:"attempt_id"`
	TenantID                  string    `json:"tenant_id"`
	CandidateAssignmentID     string    `json:"candidate_assignment_id"`
	CandidateID               string    `json:"candidate_id"`
	ExamID                    string    `json:"exam_id"`
	ExamVersionID             string    `json:"exam_version_id"`
	AttemptNumber             int       `json:"attempt_number"`
	LifecycleState            string    `json:"lifecycle_state"`
	CancellationReason        string    `json:"cancellation_reason"`
	AssessmentSnapshotEventID string    `json:"assessment_snapshot_event_id"`
	CancelledAt               time.Time `json:"cancelled_at"`
}

// ApplyAttemptCancelled retains the terminal cancellation as an audit fact.
// Nonterminal attempts never produce an Analytics score row, while terminal
// graded attempts are intentionally left unchanged by Submission.
func (store *Store) ApplyAttemptCancelled(ctx context.Context, event messaging.Event) error {
	var payload attemptCancelled
	if err := decodeEvent(event, AttemptCancelledEventType, &payload); err != nil ||
		!sameUUID(payload.TenantID, event.TenantID) || !validUUID(payload.AttemptID) ||
		!validUUID(payload.CandidateAssignmentID) || !validUUID(payload.CandidateID) ||
		!validUUID(payload.ExamID) || !validUUID(payload.ExamVersionID) ||
		!validUUID(payload.AssessmentSnapshotEventID) || payload.AttemptNumber < 1 ||
		payload.AttemptNumber > 20 || payload.LifecycleState != "cancelled" ||
		payload.CancellationReason != "assessment_assignment_revoked" || payload.CancelledAt.IsZero() {
		return permanent("cancelled attempt event is invalid", err)
	}
	return store.process(ctx, "analytics_attempt_cancelled_v1", event, func(tx pgx.Tx) error {
		return store.recordEventFact(ctx, tx, event)
	})
}

type legalHoldPlaced struct {
	LegalHoldID string `json:"legal_hold_id"`
	TenantID    string `json:"tenant_id"`
	Scope       string `json:"scope"`
	SubjectID   string `json:"subject_id"`
}

func (store *Store) ApplyLegalHoldPlaced(ctx context.Context, event messaging.Event) error {
	var payload legalHoldPlaced
	if err := decodeEvent(event, LegalHoldPlacedEventType, &payload); err != nil ||
		!sameUUID(payload.TenantID, event.TenantID) || !validUUID(payload.LegalHoldID) ||
		!validLegalHoldScope(payload.Scope, payload.SubjectID) {
		return permanent("legal hold placement event is invalid", err)
	}
	return store.process(ctx, "analytics_legal_hold_placed_v1", event, func(tx pgx.Tx) error {
		if err := store.recordEventFact(ctx, tx, event); err != nil {
			return err
		}
		var subjectID any
		if payload.SubjectID != "" {
			subjectID = payload.SubjectID
		}
		if _, err := tx.Exec(ctx, `SELECT analytics.apply_legal_hold($1, $2, $3, $4, true, $5)`,
			payload.TenantID, payload.LegalHoldID, payload.Scope, subjectID, event.ID); err != nil {
			return projectionError(err, "apply legal hold")
		}
		return nil
	})
}

type legalHoldReleased struct {
	LegalHoldID string `json:"legal_hold_id"`
	TenantID    string `json:"tenant_id"`
}

func (store *Store) ApplyLegalHoldReleased(ctx context.Context, event messaging.Event) error {
	var payload legalHoldReleased
	if err := decodeEvent(event, LegalHoldReleasedEventType, &payload); err != nil ||
		!sameUUID(payload.TenantID, event.TenantID) || !validUUID(payload.LegalHoldID) {
		return permanent("legal hold release event is invalid", err)
	}
	return store.process(ctx, "analytics_legal_hold_released_v1", event, func(tx pgx.Tx) error {
		if err := store.recordEventFact(ctx, tx, event); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `SELECT analytics.apply_legal_hold($1, $2, NULL, NULL, false, $3)`,
			payload.TenantID, payload.LegalHoldID, event.ID); err != nil {
			return projectionError(err, "release legal hold")
		}
		return nil
	})
}

type retentionPolicyUpdated struct {
	TenantID string `json:"tenant_id"`
	Version  int    `json:"version"`
}

func (store *Store) ApplyRetentionPolicyUpdated(ctx context.Context, event messaging.Event) error {
	var payload retentionPolicyUpdated
	if err := decodeEvent(event, RetentionPolicyUpdatedEventType, &payload); err != nil ||
		!sameUUID(payload.TenantID, event.TenantID) || payload.Version <= 0 {
		return permanent("retention policy event is invalid", err)
	}
	return store.process(ctx, "analytics_retention_policy_updated_v1", event, func(tx pgx.Tx) error {
		if err := store.recordEventFact(ctx, tx, event); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO analytics.retention_policy_revisions (tenant_id, source_version, source_event_id)
			VALUES ($1, $2, $3)
			ON CONFLICT (tenant_id) DO UPDATE
			SET source_version = EXCLUDED.source_version, source_event_id = EXCLUDED.source_event_id,
				updated_at = clock_timestamp()
			WHERE EXCLUDED.source_version >= analytics.retention_policy_revisions.source_version
		`, payload.TenantID, payload.Version, event.ID)
		if err != nil {
			return projectionError(err, "record retention policy revision")
		}
		return nil
	})
}

func (store *Store) process(ctx context.Context, consumer string, event messaging.Event, apply func(pgx.Tx) error) error {
	_, err := store.inbox.Process(ctx, consumer, event, func(_ context.Context, tx pgx.Tx, _ messaging.Event) error {
		return apply(tx)
	})
	return err
}

func (store *Store) rebuildBatchProgress(ctx context.Context, tx pgx.Tx, tenantID, batchID string) error {
	if _, err := tx.Exec(ctx, `SELECT analytics.rebuild_batch_progress($1::uuid, $2::uuid)`, tenantID, batchID); err != nil {
		return projectionError(err, "rebuild batch progress")
	}
	return nil
}

func (store *Store) rebuildStudentBatchProgress(ctx context.Context, tx pgx.Tx, tenantID string, studentIDs ...string) error {
	seen := make(map[string]struct{}, len(studentIDs))
	for _, studentID := range studentIDs {
		if !validUUID(studentID) {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(studentID))
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		if _, err := tx.Exec(ctx, `SELECT analytics.rebuild_student_batch_progress($1::uuid, $2::uuid)`, tenantID, studentID); err != nil {
			return projectionError(err, "rebuild student batch progress")
		}
	}
	return nil
}

func (store *Store) recordEventFact(ctx context.Context, tx pgx.Tx, event messaging.Event) error {
	if !validTenantEvent(event) {
		return messaging.Permanent(fmt.Errorf("analytics event fact envelope is invalid"))
	}
	if _, err := tx.Exec(ctx, `SELECT app.ensure_analytics_event_fact_partitions($1)`, event.OccurredAt.UTC()); err != nil {
		return projectionError(err, "ensure analytics event partition")
	}
	factID, err := database.NewUUIDv7()
	if err != nil {
		return err
	}
	var legalHold bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM analytics.legal_hold_projections AS hold
			WHERE hold.tenant_id = $1 AND hold.active
			  AND (hold.scope = 'tenant' OR hold.subject_id = $2::uuid)
		)
	`, event.TenantID, event.AggregateID).Scan(&legalHold); err != nil {
		return projectionError(err, "resolve analytics legal hold")
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO analytics.event_facts (
			id, occurred_at, tenant_id, source_event_id, source_service,
			event_type, subject_id, source_subject_type, payload, legal_hold
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
		ON CONFLICT (source_event_id, occurred_at) DO NOTHING
	`, factID, event.OccurredAt.UTC(), event.TenantID, event.ID, sourceService(event.Type),
		event.Type, event.AggregateID, event.AggregateType, string(event.Payload), legalHold)
	if err != nil {
		return projectionError(err, "append analytics event fact")
	}
	return nil
}

func decodeEvent(event messaging.Event, eventType string, destination any) error {
	if event.Type != eventType || event.SchemaVersion != 1 || !validUUID(event.ID) || !validUUID(event.AggregateID) {
		return fmt.Errorf("unsupported event envelope")
	}
	decoder := json.NewDecoder(bytes.NewReader(event.Payload))
	decoder.UseNumber()
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("event payload must contain exactly one JSON value")
	}
	return nil
}

func decodeStudentBatchAffiliationSnapshot(event messaging.Event) (studentBatchAffiliationSnapshot, error) {
	var payload studentBatchAffiliationSnapshot
	if err := decodeEvent(event, StudentBatchAffiliationEventType, &payload); err != nil {
		return studentBatchAffiliationSnapshot{}, err
	}
	if !validTenantEvent(event) || !sameUUID(payload.TenantID, event.TenantID) ||
		!validUUID(payload.StudentID) || payload.Version <= 0 {
		return studentBatchAffiliationSnapshot{}, fmt.Errorf("student batch affiliation snapshot fields are invalid")
	}
	switch payload.LifecycleState {
	case "active":
		if payload.BatchID == nil || !validUUID(*payload.BatchID) {
			return studentBatchAffiliationSnapshot{}, fmt.Errorf("active student batch affiliation requires a batch identifier")
		}
	case "inactive":
		if payload.BatchID != nil && !validUUID(*payload.BatchID) {
			return studentBatchAffiliationSnapshot{}, fmt.Errorf("inactive student batch affiliation batch identifier is invalid")
		}
	default:
		return studentBatchAffiliationSnapshot{}, fmt.Errorf("student batch affiliation lifecycle state is invalid")
	}
	return payload, nil
}

func validTenantEvent(event messaging.Event) bool {
	return validUUID(event.ID) && validUUID(event.AggregateID) && validUUID(event.TenantID) && !event.OccurredAt.IsZero()
}

func validAssignmentItems(items []assignmentItem) bool {
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		if !validUUID(item.ExamItemID) || strings.TrimSpace(item.EvaluationBundleObjectKey) == "" ||
			!validSHA256(item.EvaluationBundleChecksum) || !positiveNumber(item.MaximumScore) {
			return false
		}
		if _, exists := seen[item.ExamItemID]; exists {
			return false
		}
		seen[item.ExamItemID] = struct{}{}
	}
	return true
}

func validLegalHoldScope(scope, subjectID string) bool {
	if scope == "tenant" {
		return subjectID == ""
	}
	return (scope == "student" || scope == "assessment" || scope == "submission") && validUUID(subjectID)
}

func validVerdict(value string) bool {
	switch value {
	case "accepted", "wrong_answer", "time_limit_exceeded", "memory_limit_exceeded", "runtime_error", "compile_error", "internal_error", "cancelled":
		return true
	default:
		return false
	}
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

func positiveNumber(value json.Number) bool {
	parsed, err := strconv.ParseFloat(value.String(), 64)
	return err == nil && !math.IsNaN(parsed) && !math.IsInf(parsed, 0) && parsed > 0
}

func nonNegativeNumber(value json.Number) bool {
	parsed, err := strconv.ParseFloat(value.String(), 64)
	return err == nil && !math.IsNaN(parsed) && !math.IsInf(parsed, 0) && parsed >= 0
}

func scoreWithinMaximum(score, maximum json.Number) bool {
	scoreValue, scoreErr := strconv.ParseFloat(score.String(), 64)
	maximumValue, maximumErr := strconv.ParseFloat(maximum.String(), 64)
	return scoreErr == nil && maximumErr == nil && scoreValue <= maximumValue
}

func validSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, character := range strings.ToLower(value) {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
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

func sameUUID(left, right string) bool {
	return validUUID(left) && validUUID(right) && strings.EqualFold(strings.TrimSpace(left), strings.TrimSpace(right))
}

func sourceService(eventType string) string {
	parts := strings.SplitN(eventType, ".", 2)
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		return "unknown"
	}
	return parts[0]
}

func permanent(message string, cause error) error {
	if cause == nil {
		return messaging.Permanent(fmt.Errorf("%s", message))
	}
	return messaging.Permanent(fmt.Errorf("%s: %w", message, cause))
}

func projectionError(err error, operation string) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && (postgresError.Code == "P0001" || postgresError.Code == "22P02" || postgresError.Code == "23514" || postgresError.Code == "22023") {
		return messaging.Permanent(fmt.Errorf("%s: %w", operation, err))
	}
	return fmt.Errorf("%s: %w", operation, err)
}
