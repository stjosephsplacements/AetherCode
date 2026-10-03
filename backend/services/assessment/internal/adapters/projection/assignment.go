// Package projection materializes candidate assignments when students enroll or
// join batches matching active assignment rules. It never reads User's database
// directly.
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
	StudentEnrolledEventType         = "user.student.enrolled.v1"
	StudentBatchAffiliationEventType = "user.student_batch_affiliation.snapshot.v1"
	BatchCreatedEventType            = "tenant.batch.created.v1"
	AssignmentRuleCreatedEventType   = "assessment.assignment_rule.created.v1"
)

type MaterializationStore struct {
	pool *pgxpool.Pool
}

func NewMaterializationStore(pool *pgxpool.Pool) (*MaterializationStore, error) {
	if pool == nil {
		return nil, fmt.Errorf("assessment materialization database pool is required")
	}
	return &MaterializationStore{pool: pool}, nil
}

func (store *MaterializationStore) Ping(ctx context.Context) error {
	if store == nil || store.pool == nil {
		return fmt.Errorf("assessment materialization store is not initialized")
	}
	if err := store.pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping assessment materialization database: %w", err)
	}
	return nil
}

type studentEnrolledPayload struct {
	TenantID     string `json:"tenant_id"`
	StudentID    string `json:"student_id"`
	BatchID      string `json:"batch_id"`
	DepartmentID string `json:"department_id"`
}

func (store *MaterializationStore) ApplyStudentEnrolled(ctx context.Context, event messaging.Event) error {
	payload, err := parseStudentEnrolled(event)
	if err != nil {
		return messaging.Permanent(err)
	}
	return store.apply(ctx, "assessment_student_enrolled_v1", event, func(transaction pgx.Tx) error {
		if _, err := transaction.Exec(ctx, `
			SELECT assessment.apply_student_enrollment($1, $2, $3, $4)
		`, event.ID, payload.TenantID, payload.StudentID, payload.BatchID); err != nil {
			return materializationError(err, "apply student enrollment projection")
		}
		if _, err := transaction.Exec(ctx, `
			SELECT assessment.materialize_from_enrollment($1, $2, $3, $4)
		`, event.ID, payload.TenantID, payload.StudentID, payload.BatchID); err != nil {
			return materializationError(err, "materialize candidate assignments from enrollment")
		}
		return nil
	})
}

type batchAffiliationPayload struct {
	TenantID       string  `json:"tenant_id"`
	StudentID      string  `json:"student_id"`
	BatchID        *string `json:"batch_id"`
	LifecycleState string  `json:"lifecycle_state"`
	Version        int64   `json:"version"`
}

func (store *MaterializationStore) ApplyBatchAffiliation(ctx context.Context, event messaging.Event) error {
	payload, err := parseBatchAffiliation(event)
	if err != nil {
		return messaging.Permanent(err)
	}
	if payload.LifecycleState != "active" {
		return store.apply(ctx, "assessment_batch_affiliation_v1", event, func(transaction pgx.Tx) error {
			return nil
		})
	}
	return store.apply(ctx, "assessment_batch_affiliation_v1", event, func(transaction pgx.Tx) error {
		if _, err := transaction.Exec(ctx, `
			SELECT assessment.materialize_from_batch_affiliation($1, $2, $3, $4, $5)
		`, event.ID, payload.TenantID, payload.StudentID, *payload.BatchID, payload.LifecycleState); err != nil {
			return materializationError(err, "materialize candidate assignments from batch affiliation")
		}
		return nil
	})
}

type batchCreatedPayload struct {
	TenantID     string `json:"tenant_id"`
	BatchID      string `json:"batch_id"`
	DepartmentID string `json:"department_id"`
}

func (store *MaterializationStore) ApplyBatchCreated(ctx context.Context, event messaging.Event) error {
	payload, err := parseBatchCreated(event)
	if err != nil {
		return messaging.Permanent(err)
	}
	return store.apply(ctx, "assessment_batch_created_v1", event, func(transaction pgx.Tx) error {
		if _, err := transaction.Exec(ctx, `
			SELECT assessment.apply_batch_projection($1, $2, $3, $4)
		`, event.ID, payload.TenantID, payload.BatchID, payload.DepartmentID); err != nil {
			return materializationError(err, "apply batch department projection")
		}
		return nil
	})
}

type assignmentRuleCreatedPayload struct {
	TenantID         string `json:"tenant_id"`
	AssignmentRuleID string `json:"assignment_rule_id"`
	ExamVersionID    string `json:"exam_version_id"`
	TargetType       string `json:"target_type"`
	TargetID         string `json:"target_id"`
}

func (store *MaterializationStore) ApplyAssignmentRuleCreated(ctx context.Context, event messaging.Event) error {
	payload, err := parseAssignmentRuleCreated(event)
	if err != nil {
		return messaging.Permanent(err)
	}
	if payload.TargetType == "student" || payload.TargetType == "placement_department" {
		return store.apply(ctx, "assessment_assignment_rule_created_v1", event, func(transaction pgx.Tx) error {
			return nil
		})
	}
	return store.apply(ctx, "assessment_assignment_rule_created_v1", event, func(transaction pgx.Tx) error {
		if _, err := transaction.Exec(ctx, `
			SELECT assessment.backfill_from_assignment_rule($1, $2, $3, $4, $5)
		`, event.ID, payload.TenantID, payload.AssignmentRuleID, payload.TargetType, payload.TargetID); err != nil {
			return materializationError(err, "backfill assignments from rule")
		}
		return nil
	})
}

func (store *MaterializationStore) apply(ctx context.Context, consumer string, event messaging.Event, applyFunc func(pgx.Tx) error) error {
	if store == nil || store.pool == nil {
		return fmt.Errorf("assessment materialization store is not initialized")
	}
	transaction, err := store.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin assessment materialization transaction: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	payloadHash := sha256.Sum256(event.Payload)
	var claimedID string
	err = transaction.QueryRow(ctx, `
		INSERT INTO app.projection_inbox_messages (
			consumer_name, event_id, payload_sha256, occurred_at
		) VALUES ($1, $2, $3, $4)
		ON CONFLICT (consumer_name, event_id) DO NOTHING
		RETURNING event_id::text
	`, consumer, event.ID, payloadHash[:], event.OccurredAt.UTC()).Scan(&claimedID)
	if errors.Is(err, pgx.ErrNoRows) {
		if commitErr := transaction.Commit(ctx); commitErr != nil {
			return fmt.Errorf("commit duplicate assessment materialization event: %w", commitErr)
		}
		return nil
	}
	if err != nil {
		return fmt.Errorf("claim assessment materialization event: %w", err)
	}
	if err := applyFunc(transaction); err != nil {
		return err
	}
	if _, err := transaction.Exec(ctx, `
		UPDATE app.projection_inbox_messages
		SET processed_at = clock_timestamp(), last_error = NULL
		WHERE consumer_name = $1 AND event_id = $2
	`, consumer, claimedID); err != nil {
		return fmt.Errorf("complete assessment materialization event: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit assessment materialization event: %w", err)
	}
	return nil
}

func parseStudentEnrolled(event messaging.Event) (studentEnrolledPayload, error) {
	if event.Type != StudentEnrolledEventType || event.SchemaVersion != 1 || !validUUID(event.ID) {
		return studentEnrolledPayload{}, fmt.Errorf("unsupported student enrollment event")
	}
	var payload studentEnrolledPayload
	if err := decodePayload(event.Payload, &payload); err != nil {
		return studentEnrolledPayload{}, err
	}
	if !validUUID(payload.TenantID) || !validUUID(payload.StudentID) ||
		!validUUID(payload.BatchID) || !validUUID(payload.DepartmentID) {
		return studentEnrolledPayload{}, fmt.Errorf("student enrollment payload is invalid")
	}
	return payload, nil
}

func parseBatchAffiliation(event messaging.Event) (batchAffiliationPayload, error) {
	if event.Type != StudentBatchAffiliationEventType || event.SchemaVersion != 1 || !validUUID(event.ID) {
		return batchAffiliationPayload{}, fmt.Errorf("unsupported student batch affiliation event")
	}
	var payload batchAffiliationPayload
	if err := decodePayload(event.Payload, &payload); err != nil {
		return batchAffiliationPayload{}, err
	}
	if !validUUID(payload.TenantID) || !validUUID(payload.StudentID) || payload.Version <= 0 {
		return batchAffiliationPayload{}, fmt.Errorf("student batch affiliation payload is invalid")
	}
	if payload.LifecycleState != "active" && payload.LifecycleState != "inactive" {
		return batchAffiliationPayload{}, fmt.Errorf("student batch affiliation lifecycle state is invalid")
	}
	if payload.LifecycleState == "active" {
		if payload.BatchID == nil || !validUUID(*payload.BatchID) {
			return batchAffiliationPayload{}, fmt.Errorf("active batch affiliation requires valid batch ID")
		}
	} else {
		if payload.BatchID != nil && !validUUID(*payload.BatchID) {
			return batchAffiliationPayload{}, fmt.Errorf("inactive batch affiliation batch ID is invalid")
		}
	}
	return payload, nil
}

func decodePayload(raw []byte, target any) error {
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("decode assessment materialization payload: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("assessment materialization payload must contain exactly one JSON value")
	}
	return nil
}

func parseBatchCreated(event messaging.Event) (batchCreatedPayload, error) {
	if event.Type != BatchCreatedEventType || event.SchemaVersion != 1 || !validUUID(event.ID) {
		return batchCreatedPayload{}, fmt.Errorf("unsupported batch created event")
	}
	var payload batchCreatedPayload
	if err := decodePayload(event.Payload, &payload); err != nil {
		return batchCreatedPayload{}, err
	}
	if !validUUID(payload.TenantID) || !validUUID(payload.BatchID) || !validUUID(payload.DepartmentID) {
		return batchCreatedPayload{}, fmt.Errorf("batch created payload is invalid")
	}
	return payload, nil
}

func parseAssignmentRuleCreated(event messaging.Event) (assignmentRuleCreatedPayload, error) {
	if event.Type != AssignmentRuleCreatedEventType || event.SchemaVersion != 1 || !validUUID(event.ID) {
		return assignmentRuleCreatedPayload{}, fmt.Errorf("unsupported assignment rule created event")
	}
	var payload assignmentRuleCreatedPayload
	if err := decodePayload(event.Payload, &payload); err != nil {
		return assignmentRuleCreatedPayload{}, err
	}
	if !validUUID(payload.TenantID) || !validUUID(payload.AssignmentRuleID) ||
		!validUUID(payload.ExamVersionID) || !validUUID(payload.TargetID) {
		return assignmentRuleCreatedPayload{}, fmt.Errorf("assignment rule created payload is invalid")
	}
	if payload.TargetType == "" {
		return assignmentRuleCreatedPayload{}, fmt.Errorf("assignment rule created payload target type is required")
	}
	return payload, nil
}

func materializationError(err error, operation string) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && (postgresError.Code == "P0001" || postgresError.Code == "22P02" || postgresError.Code == "23514" || postgresError.Code == "22023") {
		return messaging.Permanent(fmt.Errorf("%s: %w", operation, err))
	}
	return fmt.Errorf("%s: %w", operation, err)
}

func validUUID(value string) bool {
	parsed, err := uuid.Parse(strings.TrimSpace(value))
	return err == nil && strings.EqualFold(parsed.String(), strings.TrimSpace(value))
}
