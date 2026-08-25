// Package repo implements Submission's PostgreSQL persistence boundary.
package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/messaging"
	"github.com/aethercode/aethercode/services/submission/internal/app"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct {
	pool   *pgxpool.Pool
	outbox *messaging.OutboxStore
}

func NewPostgres(pool *pgxpool.Pool) (*Postgres, error) {
	if pool == nil {
		return nil, fmt.Errorf("submission database pool is required")
	}
	outbox, err := messaging.NewOutboxStore(pool, "app.outbox_events")
	if err != nil {
		return nil, err
	}
	return &Postgres{pool: pool, outbox: outbox}, nil
}

func (repository *Postgres) Ping(contextValue context.Context) error {
	if err := repository.pool.Ping(contextValue); err != nil {
		return fmt.Errorf("ping Submission database: %w", err)
	}
	return nil
}

func (repository *Postgres) StartAttempt(contextValue context.Context, transaction pgx.Tx, command app.StartAttempt) (app.Attempt, error) {
	attempt, err := scanAttempt(transaction.QueryRow(contextValue, `
		SELECT id, tenant_id, exam_id, exam_version_id, candidate_id, candidate_assignment_id,
		       attempt_number, lifecycle_state, available_from, submission_deadline,
		       started_at, submitted_at, completed_at, version, created_at
		FROM submission.start_attempt($1, $2, $3, $4, $5, $6)
	`, command.ID, command.EventID, command.TenantID, command.CandidateAssignmentID,
		command.IdempotencyKey, command.RequestChecksum))
	if err != nil {
		return app.Attempt{}, err
	}

	var payload []byte
	var occurredAt time.Time
	err = transaction.QueryRow(contextValue, `
		SELECT payload, occurred_at
		FROM submission.prepare_attempt_started_outbox_event($1, $2, $3, $4)
	`, command.EventID, command.OutboxEventID, command.TenantID, attempt.ID).Scan(&payload, &occurredAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return attempt, nil
	}
	if err != nil {
		return app.Attempt{}, mapDatabaseError(err, "prepare attempt started outbox event")
	}
	if err := repository.outbox.Enqueue(contextValue, transaction, database.OutboxEvent{
		EventID: command.OutboxEventID, AggregateType: "attempt", AggregateID: attempt.ID,
		TenantID: command.TenantID, EventType: "submission.attempt_started.v1", SchemaVersion: 1,
		Payload: payload, OccurredAt: occurredAt,
	}); err != nil {
		return app.Attempt{}, fmt.Errorf("enqueue attempt started: %w", err)
	}
	return attempt, nil
}

func (repository *Postgres) GetAttempt(contextValue context.Context, transaction pgx.Tx, command app.GetAttempt) (app.Attempt, error) {
	return scanAttempt(transaction.QueryRow(contextValue, `
		SELECT id, tenant_id, exam_id, exam_version_id, candidate_id, candidate_assignment_id,
		       attempt_number, lifecycle_state, available_from, submission_deadline,
		       started_at, submitted_at, completed_at, version, created_at
		FROM submission.get_attempt_for_candidate($1, $2)
	`, command.TenantID, command.AttemptID))
}

func (repository *Postgres) AppendAnswerRevision(contextValue context.Context, transaction pgx.Tx, command app.AppendAnswerRevision) (app.AnswerRevision, error) {
	var revision app.AnswerRevision
	err := transaction.QueryRow(contextValue, `
		SELECT id, tenant_id, attempt_id, exam_item_id, revision_number, language_id,
		       source_object_key, source_checksum, encryption_key_reference,
		       created_at, created_by, attempt_version
		FROM submission.append_answer_revision($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, command.ID, command.EventID, command.TenantID, command.AttemptID, command.ExamItemID,
		command.LanguageID, command.SourceObjectKey, command.SourceChecksum,
		command.EncryptionKeyReference, command.ExpectedAttemptVersion).Scan(
		&revision.ID, &revision.TenantID, &revision.AttemptID, &revision.ExamItemID,
		&revision.RevisionNumber, &revision.LanguageID, &revision.SourceObjectKey,
		&revision.SourceChecksum, &revision.EncryptionKeyReference, &revision.CreatedAt,
		&revision.CreatedBy, &revision.AttemptVersion,
	)
	if err != nil {
		return app.AnswerRevision{}, mapDatabaseError(err, "append answer revision")
	}
	return revision, nil
}

func (repository *Postgres) PrepareSubmission(contextValue context.Context, transaction pgx.Tx, command app.PrepareSubmission) ([]app.EvaluationPreparation, error) {
	rows, err := transaction.Query(contextValue, `
		SELECT answer_revision_id, exam_item_id, evaluation_bundle_object_key,
		       evaluation_bundle_checksum, maximum_score::text
		FROM submission.prepare_submission($1, $2, $3)
	`, command.TenantID, command.AttemptID, command.ExpectedAttemptVersion)
	if err != nil {
		return nil, mapDatabaseError(err, "prepare attempt submission")
	}
	defer rows.Close()
	prepared := make([]app.EvaluationPreparation, 0)
	for rows.Next() {
		var item app.EvaluationPreparation
		if err := rows.Scan(
			&item.AnswerRevisionID, &item.ExamItemID, &item.EvaluationBundleObjectKey,
			&item.EvaluationBundleChecksum, &item.MaximumScore,
		); err != nil {
			return nil, fmt.Errorf("scan submission evaluation preparation: %w", err)
		}
		prepared = append(prepared, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate submission evaluation preparation: %w", err)
	}
	return prepared, nil
}

func (repository *Postgres) SubmitAttempt(contextValue context.Context, transaction pgx.Tx, command app.SubmitAttempt) (app.Attempt, error) {
	payload, err := marshalEvaluationRequests(command.EvaluationRequests)
	if err != nil {
		return app.Attempt{}, err
	}
	attempt, err := scanAttempt(transaction.QueryRow(contextValue, `
		SELECT id, tenant_id, exam_id, exam_version_id, candidate_id, candidate_assignment_id,
		       attempt_number, lifecycle_state, available_from, submission_deadline,
		       started_at, submitted_at, completed_at, version, created_at
		FROM submission.submit_attempt($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
	`, command.SubmittedEventID, command.GradingEventID, command.TenantID, command.AttemptID,
		command.ExpectedAttemptVersion, command.IdempotencyKey, command.RequestChecksum, string(payload)))
	if err != nil {
		return app.Attempt{}, err
	}

	var submittedPayload []byte
	var submittedAt time.Time
	submittedErr := transaction.QueryRow(contextValue, `
		SELECT payload, occurred_at
		FROM submission.prepare_attempt_submitted_outbox_event($1, $2, $3, $4)
	`, command.SubmittedEventID, command.SubmittedOutboxEventID, command.TenantID, attempt.ID).Scan(&submittedPayload, &submittedAt)
	if submittedErr == nil {
		if err := repository.outbox.Enqueue(contextValue, transaction, database.OutboxEvent{
			EventID: command.SubmittedOutboxEventID, AggregateType: "attempt", AggregateID: attempt.ID,
			TenantID: command.TenantID, EventType: "submission.attempt_submitted.v1", SchemaVersion: 1,
			Payload: submittedPayload, OccurredAt: submittedAt,
		}); err != nil {
			return app.Attempt{}, fmt.Errorf("enqueue attempt submitted: %w", err)
		}
	} else if !errors.Is(submittedErr, pgx.ErrNoRows) {
		return app.Attempt{}, mapDatabaseError(submittedErr, "prepare attempt submitted outbox event")
	}

	if len(command.EvaluationRequests) == 0 {
		return attempt, nil
	}
	for _, request := range command.EvaluationRequests {
		eventPayload, marshalErr := json.Marshal(struct {
			EvaluationRequestID       string      `json:"evaluation_request_id"`
			AttemptID                 string      `json:"attempt_id"`
			AnswerRevisionID          string      `json:"answer_revision_id"`
			ExamItemID                string      `json:"exam_item_id"`
			EvaluationBundleObjectKey string      `json:"evaluation_bundle_object_key"`
			EvaluationBundleChecksum  string      `json:"evaluation_bundle_checksum"`
			MaximumScore              json.Number `json:"maximum_score"`
			CallerIdempotencyKey      string      `json:"caller_idempotency_key"`
		}{
			EvaluationRequestID: request.ID, AttemptID: command.AttemptID,
			AnswerRevisionID: request.AnswerRevisionID, ExamItemID: request.ExamItemID,
			EvaluationBundleObjectKey: request.EvaluationBundleObjectKey,
			EvaluationBundleChecksum:  request.EvaluationBundleChecksum,
			MaximumScore:              json.Number(request.MaximumScore), CallerIdempotencyKey: request.CallerIdempotencyKey,
		})
		if marshalErr != nil {
			return app.Attempt{}, fmt.Errorf("encode evaluation request event: %w", marshalErr)
		}
		if err := repository.outbox.Enqueue(contextValue, transaction, database.OutboxEvent{
			EventID: request.OutboxEventID, AggregateType: "evaluation_request", AggregateID: request.ID,
			TenantID: command.TenantID, EventType: "submission.evaluation_requested.v1", SchemaVersion: 1,
			Payload: eventPayload, OccurredAt: time.Now().UTC(),
		}); err != nil {
			return app.Attempt{}, fmt.Errorf("enqueue evaluation request: %w", err)
		}
	}
	return attempt, nil
}

func (repository *Postgres) CountEvaluationRequests(contextValue context.Context, transaction pgx.Tx, command app.GetAttempt) (int, error) {
	var count int
	err := transaction.QueryRow(contextValue, `
		SELECT submission.count_evaluation_requests_for_candidate($1, $2)
	`, command.TenantID, command.AttemptID).Scan(&count)
	if err != nil {
		return 0, mapDatabaseError(err, "count evaluation requests")
	}
	return count, nil
}

type attemptScanner interface {
	Scan(...any) error
}

func scanAttempt(row attemptScanner) (app.Attempt, error) {
	var attempt app.Attempt
	err := row.Scan(
		&attempt.ID, &attempt.TenantID, &attempt.ExamID, &attempt.ExamVersionID,
		&attempt.CandidateID, &attempt.CandidateAssignmentID, &attempt.AttemptNumber,
		&attempt.LifecycleState, &attempt.AvailableFrom, &attempt.SubmissionDeadline,
		&attempt.StartedAt, &attempt.SubmittedAt, &attempt.CompletedAt, &attempt.Version,
		&attempt.CreatedAt,
	)
	if err != nil {
		return app.Attempt{}, mapDatabaseError(err, "read attempt")
	}
	return attempt, nil
}

func marshalEvaluationRequests(requests []app.EvaluationRequest) ([]byte, error) {
	if requests == nil {
		return []byte("[]"), nil
	}
	payload := make([]struct {
		ID                        string      `json:"id"`
		AnswerRevisionID          string      `json:"answer_revision_id"`
		ExamItemID                string      `json:"exam_item_id"`
		EvaluationBundleObjectKey string      `json:"evaluation_bundle_object_key"`
		EvaluationBundleChecksum  string      `json:"evaluation_bundle_checksum"`
		MaximumScore              json.Number `json:"maximum_score"`
		CallerIdempotencyKey      string      `json:"caller_idempotency_key"`
	}, 0, len(requests))
	for _, request := range requests {
		payload = append(payload, struct {
			ID                        string      `json:"id"`
			AnswerRevisionID          string      `json:"answer_revision_id"`
			ExamItemID                string      `json:"exam_item_id"`
			EvaluationBundleObjectKey string      `json:"evaluation_bundle_object_key"`
			EvaluationBundleChecksum  string      `json:"evaluation_bundle_checksum"`
			MaximumScore              json.Number `json:"maximum_score"`
			CallerIdempotencyKey      string      `json:"caller_idempotency_key"`
		}{
			ID: request.ID, AnswerRevisionID: request.AnswerRevisionID, ExamItemID: request.ExamItemID,
			EvaluationBundleObjectKey: request.EvaluationBundleObjectKey,
			EvaluationBundleChecksum:  request.EvaluationBundleChecksum,
			MaximumScore:              json.Number(request.MaximumScore), CallerIdempotencyKey: request.CallerIdempotencyKey,
		})
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode evaluation request snapshot: %w", err)
	}
	return encoded, nil
}

// GetAttemptIncludeDeleted retrieves attempt including soft-deleted records.
// Requires authorization check before calling (SuperAdmin or role with archive access).
// Includes legal_hold status required for ADR-0007 purge-hold enforcement.
func (repository *Postgres) GetAttemptIncludeDeleted(contextValue context.Context, transaction pgx.Tx, command app.GetAttempt) (app.Attempt, error) {
	var attempt app.Attempt
	err := transaction.QueryRow(contextValue, `
		SELECT id, tenant_id, exam_id, exam_version_id, candidate_id, candidate_assignment_id,
		       attempt_number, lifecycle_state, available_from, submission_deadline,
		       started_at, submitted_at, completed_at, legal_hold, version, created_at
		FROM submission.attempts
		WHERE tenant_id = $1 AND id = $2
	`, command.TenantID, command.AttemptID).Scan(
		&attempt.ID, &attempt.TenantID, &attempt.ExamID, &attempt.ExamVersionID,
		&attempt.CandidateID, &attempt.CandidateAssignmentID, &attempt.AttemptNumber,
		&attempt.LifecycleState, &attempt.AvailableFrom, &attempt.SubmissionDeadline,
		&attempt.StartedAt, &attempt.SubmittedAt, &attempt.CompletedAt, &attempt.LegalHold,
		&attempt.Version, &attempt.CreatedAt,
	)
	if err != nil {
		return app.Attempt{}, mapDatabaseError(err, "read attempt")
	}
	return attempt, nil
}

// SoftDeleteAttempt marks attempt as deleted with audit trail.
// Uses UPDATE with deleted_at, deleted_by, deletion_reason per ADR-0013.
func (repository *Postgres) SoftDeleteAttempt(contextValue context.Context, transaction pgx.Tx, command app.DeleteAttempt) error {
	result, err := transaction.Exec(contextValue, `
		UPDATE submission.attempts
		SET deleted_at = clock_timestamp(),
		    deleted_by = $2,
		    deletion_reason = $3,
		    version = version + 1
		WHERE id = $1
		  AND deleted_at IS NULL
	`, command.ID, command.ActorID, command.Reason)
	if err != nil {
		return mapDatabaseError(err, "soft delete failed")
	}
	if result.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "attempt not found or already deleted")
	}

	payload, err := json.Marshal(struct {
		AttemptID string `json:"attempt_id"`
		ActorID   string `json:"actor_id"`
		Reason    string `json:"reason"`
	}{
		AttemptID: command.ID,
		ActorID:   command.ActorID,
		Reason:    command.Reason,
	})
	if err != nil {
		return fmt.Errorf("encode attempt soft delete event: %w", err)
	}

	return repository.outbox.Enqueue(contextValue, transaction, database.OutboxEvent{
		EventID: mustNewUUIDv7(), AggregateType: "attempt", AggregateID: command.ID,
		TenantID: command.TenantID, EventType: "submission.attempt.soft_deleted.v1", SchemaVersion: 1,
		Payload: payload, OccurredAt: time.Now().UTC(),
	})
}

// HardDeleteAttempt permanently removes attempt via security-definer function.
// Only SuperAdmin can execute this (enforced via RLS and function).
func (repository *Postgres) HardDeleteAttempt(contextValue context.Context, transaction pgx.Tx, command app.DeleteAttempt) error {
	var success bool
	err := transaction.QueryRow(contextValue, `
		SELECT app.hard_delete('submission.attempts', $1::uuid, $2::uuid, $3)
	`, command.ID, command.ActorID, command.Reason).Scan(&success)
	if err != nil {
		return mapDatabaseError(err, "hard delete failed")
	}
	if !success {
		return apperrors.New(apperrors.CodeForbidden, "hard delete denied: insufficient permissions or record not found")
	}

	payload, err := json.Marshal(struct {
		AttemptID string `json:"attempt_id"`
		ActorID   string `json:"actor_id"`
		Reason    string `json:"reason"`
	}{
		AttemptID: command.ID,
		ActorID:   command.ActorID,
		Reason:    command.Reason,
	})
	if err != nil {
		return fmt.Errorf("encode attempt hard delete event: %w", err)
	}

	return repository.outbox.Enqueue(contextValue, transaction, database.OutboxEvent{
		EventID: mustNewUUIDv7(), AggregateType: "attempt", AggregateID: command.ID,
		TenantID: command.TenantID, EventType: "submission.attempt.hard_deleted.v1", SchemaVersion: 1,
		Payload: payload, OccurredAt: time.Now().UTC(),
	})
}

func mustNewUUIDv7() string {
	id, err := database.NewUUIDv7()
	if err != nil {
		panic(fmt.Sprintf("failed to generate UUIDv7: %v", err))
	}
	return id
}

func (repository *Postgres) ListAttempts(contextValue context.Context, transaction pgx.Tx, command app.ListAttempts) ([]app.Attempt, error) {
	var raw json.RawMessage
	err := transaction.QueryRow(contextValue, `
		SELECT submission.list_attempts($1, $2, $3, $4, $5, $6)
	`,
		command.TenantID, command.Limit,
		nullableTimestamp(command.CursorSort), nullableUUID(command.CursorID),
		nullableUUID(command.ExamVersionID), nullableText(command.LifecycleState),
	).Scan(&raw)
	if err != nil {
		return nil, mapDatabaseError(err, "list attempts")
	}
	var attempts []app.Attempt
	if err := json.Unmarshal(raw, &attempts); err != nil {
		return nil, fmt.Errorf("decode attempt list: %w", err)
	}
	return attempts, nil
}

func (repository *Postgres) ListAnswerRevisions(contextValue context.Context, transaction pgx.Tx, command app.ListAnswerRevisions) ([]app.AnswerRevision, error) {
	var raw json.RawMessage
	err := transaction.QueryRow(contextValue, `
		SELECT submission.list_answer_revisions($1, $2, $3, $4, $5, $6)
	`,
		command.TenantID, command.AttemptID, command.Limit,
		nullableTimestamp(command.CursorSort), nullableUUID(command.CursorID),
		nullableUUID(command.ExamItemID),
	).Scan(&raw)
	if err != nil {
		return nil, mapDatabaseError(err, "list answer revisions")
	}
	var revisions []app.AnswerRevision
	if err := json.Unmarshal(raw, &revisions); err != nil {
		return nil, fmt.Errorf("decode answer revision list: %w", err)
	}
	return revisions, nil
}

func (repository *Postgres) GetAttemptUnitSummary(contextValue context.Context, transaction pgx.Tx, command app.GetAttempt) ([]app.AttemptUnitSummary, error) {
	var raw json.RawMessage
	err := transaction.QueryRow(contextValue, `
		SELECT submission.get_attempt_unit_summary_for_candidate($1, $2)
	`, command.TenantID, command.AttemptID).Scan(&raw)
	if err != nil {
		return nil, mapDatabaseError(err, "get attempt unit summary")
	}
	var summaries []app.AttemptUnitSummary
	if err := json.Unmarshal(raw, &summaries); err != nil {
		return nil, fmt.Errorf("decode attempt unit summary: %w", err)
	}
	return summaries, nil
}

func (repository *Postgres) ListAttemptUnitResults(contextValue context.Context, transaction pgx.Tx, command app.GetAttempt) ([]app.AttemptUnitResults, error) {
	var raw json.RawMessage
	err := transaction.QueryRow(contextValue, `
		SELECT submission.list_attempt_unit_results($1, $2)
	`, command.TenantID, command.AttemptID).Scan(&raw)
	if err != nil {
		return nil, mapDatabaseError(err, "list attempt unit results")
	}
	var results []app.AttemptUnitResults
	if err := json.Unmarshal(raw, &results); err != nil {
		return nil, fmt.Errorf("decode attempt unit results: %w", err)
	}
	return results, nil
}

// nullableUUID converts an absent optional filter to a SQL NULL so one function
// signature serves both the filtered and unfiltered query.
func nullableUUID(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func nullableText(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

// nullableTimestamp parses an RFC3339 nanosecond cursor sort value. The handler
// has already validated the cursor's shape, so a parse failure here is a
// programming error rather than user input.
func nullableTimestamp(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return nil
	}
	return parsed.UTC()
}

func mapDatabaseError(err error, operation string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return apperrors.New(apperrors.CodeNotFound, "submission record was not found")
	}
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		message := strings.ToLower(postgresError.Message)
		switch postgresError.Code {
		case "42501", "28000":
			return apperrors.New(apperrors.CodeForbidden, "submission access is no longer authorized")
		case "P0001":
			if strings.Contains(message, "not found") {
				return apperrors.New(apperrors.CodeNotFound, "submission record was not found")
			}
			return apperrors.New(apperrors.CodeInvalidArgument, "submission command is invalid")
		case "23505", "55000":
			return apperrors.New(apperrors.CodeConflict, "submission state changed; refresh and retry")
		case "22023", "22P02", "23514":
			return apperrors.New(apperrors.CodeInvalidArgument, "submission command is invalid")
		}
	}
	return fmt.Errorf("%s: %w", operation, err)
}
