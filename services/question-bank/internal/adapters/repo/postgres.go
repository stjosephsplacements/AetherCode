// Package repo implements Question Bank's PostgreSQL aggregate-command port.
package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/services/question-bank/internal/app"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct {
	pool *pgxpool.Pool
}

func NewPostgres(pool *pgxpool.Pool) (*Postgres, error) {
	if pool == nil {
		return nil, fmt.Errorf("question-bank database pool is required")
	}
	return &Postgres{pool: pool}, nil
}

func (repository *Postgres) Ping(contextValue context.Context) error {
	if repository == nil || repository.pool == nil {
		return fmt.Errorf("question-bank database pool is not initialized")
	}
	if err := repository.pool.Ping(contextValue); err != nil {
		return fmt.Errorf("ping Question Bank database: %w", err)
	}
	return nil
}

func (repository *Postgres) ClaimIdempotency(contextValue context.Context, transaction pgx.Tx, claim app.IdempotencyClaim) (json.RawMessage, bool, error) {
	if transaction == nil {
		return nil, false, fmt.Errorf("idempotency transaction is required")
	}
	if _, err := transaction.Exec(contextValue, `
		WITH expired AS (
			SELECT scope_key, operation, idempotency_key
			FROM app.idempotency_keys
			WHERE expires_at <= clock_timestamp()
			ORDER BY expires_at
			LIMIT 100
		)
		DELETE FROM app.idempotency_keys AS idempotency
		USING expired
		WHERE idempotency.scope_key = expired.scope_key
		  AND idempotency.operation = expired.operation
		  AND idempotency.idempotency_key = expired.idempotency_key
	`); err != nil {
		return nil, false, fmt.Errorf("purge expired idempotency records: %w", err)
	}

	var inserted bool
	err := transaction.QueryRow(contextValue, `
		INSERT INTO app.idempotency_keys (
			tenant_id, operation, idempotency_key, request_hash, state, expires_at
		) VALUES (NULL, $1, $2, $3, 'in_progress', clock_timestamp() + interval '24 hours')
		ON CONFLICT (scope_key, operation, idempotency_key) DO NOTHING
		RETURNING true
	`, claim.Operation, claim.Key, claim.RequestHash).Scan(&inserted)
	if err == nil && inserted {
		return nil, false, nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, false, fmt.Errorf("claim idempotency key: %w", err)
	}

	var requestHash, state string
	var response json.RawMessage
	err = transaction.QueryRow(contextValue, `
		SELECT request_hash, state, response_body
		FROM app.idempotency_keys
		WHERE scope_key = 'global' AND operation = $1 AND idempotency_key = $2
		FOR UPDATE
	`, claim.Operation, claim.Key).Scan(&requestHash, &state, &response)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, fmt.Errorf("idempotency record disappeared")
	}
	if err != nil {
		return nil, false, fmt.Errorf("read idempotency record: %w", err)
	}
	if requestHash != claim.RequestHash {
		return nil, false, apperrors.New(apperrors.CodeConflict, "Idempotency-Key was previously used for a different request")
	}
	if state != "completed" || len(response) == 0 {
		return nil, false, apperrors.New(apperrors.CodeUnavailable, "request with this Idempotency-Key is still being processed")
	}
	return response, true, nil
}

func (repository *Postgres) CompleteIdempotency(contextValue context.Context, transaction pgx.Tx, claim app.IdempotencyClaim, status int, response json.RawMessage) error {
	command, err := transaction.Exec(contextValue, `
		UPDATE app.idempotency_keys
		SET state = 'completed', response_status = $4, response_body = $5,
			completed_at = clock_timestamp(), expires_at = clock_timestamp() + interval '24 hours'
		WHERE scope_key = 'global' AND operation = $1 AND idempotency_key = $2
		  AND request_hash = $3 AND state = 'in_progress'
	`, claim.Operation, claim.Key, claim.RequestHash, status, response)
	if err != nil {
		return fmt.Errorf("complete idempotency record: %w", err)
	}
	if command.RowsAffected() != 1 {
		return fmt.Errorf("idempotency record was not in progress")
	}
	return nil
}

func (repository *Postgres) CreateQuestion(contextValue context.Context, transaction pgx.Tx, command app.CreateQuestion) (app.QuestionDetail, error) {
	languages, tags, err := encodedVersionParts(command.Content)
	if err != nil {
		return app.QuestionDetail{}, err
	}
	var raw json.RawMessage
	err = transaction.QueryRow(contextValue, `
		SELECT qbank.create_question(
			$1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14::jsonb
		)
	`, command.ID, command.VersionID, command.EventID, command.Slug,
		command.Content.Title, command.Content.PromptMarkdown, command.Content.Difficulty,
		languages, command.Content.TimeLimitMS, command.Content.MemoryLimitKiB,
		command.Content.EvaluationBundle.ObjectKey, command.Content.EvaluationBundle.Checksum,
		command.Content.EvaluationBundle.EncryptionKeyReference, tags).Scan(&raw)
	if err != nil {
		return app.QuestionDetail{}, mapCommandError(err, "create question")
	}
	return decodeQuestionDetail(raw)
}

func (repository *Postgres) CreateDraftQuestionVersion(contextValue context.Context, transaction pgx.Tx, command app.CreateDraftQuestionVersion) (app.QuestionDetail, error) {
	languages, tags, err := encodedVersionParts(command.Content)
	if err != nil {
		return app.QuestionDetail{}, err
	}
	var raw json.RawMessage
	err = transaction.QueryRow(contextValue, `
		SELECT qbank.create_draft_question_version(
			$1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14::jsonb
		)
	`, command.ID, command.EventID, command.QuestionID, command.ExpectedQuestionRevision,
		command.Content.Title, command.Content.PromptMarkdown, command.Content.Difficulty,
		languages, command.Content.TimeLimitMS, command.Content.MemoryLimitKiB,
		command.Content.EvaluationBundle.ObjectKey, command.Content.EvaluationBundle.Checksum,
		command.Content.EvaluationBundle.EncryptionKeyReference, tags).Scan(&raw)
	if err != nil {
		return app.QuestionDetail{}, mapCommandError(err, "create draft question version")
	}
	return decodeQuestionDetail(raw)
}

func (repository *Postgres) UpsertTestCaseManifest(contextValue context.Context, transaction pgx.Tx, command app.UpsertTestCaseManifest) (app.QuestionVersion, error) {
	var raw json.RawMessage
	err := transaction.QueryRow(contextValue, `
		SELECT qbank.upsert_test_case_manifest($1, $2, $3, $4, $5, $6, $7, $8)
	`, command.ID, command.QuestionVersionID, command.ManifestKind,
		command.ObjectReference.ObjectKey, command.ObjectReference.Checksum,
		command.ObjectReference.EncryptionKeyReference, command.TestCaseCount,
		command.ExpectedQuestionVersion).Scan(&raw)
	if err != nil {
		return app.QuestionVersion{}, mapCommandError(err, "upsert test manifest")
	}
	return decodeQuestionVersion(raw)
}

func (repository *Postgres) AddQuestionAsset(contextValue context.Context, transaction pgx.Tx, command app.AddQuestionAsset) (app.QuestionVersion, error) {
	var raw json.RawMessage
	err := transaction.QueryRow(contextValue, `
		SELECT qbank.add_question_asset($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, command.ID, command.QuestionVersionID, command.AssetKind,
		command.ObjectReference.ObjectKey, command.ObjectReference.Checksum,
		command.ObjectReference.EncryptionKeyReference, command.ContentType,
		command.ByteSize, command.ExpectedQuestionVersion).Scan(&raw)
	if err != nil {
		return app.QuestionVersion{}, mapCommandError(err, "add question asset")
	}
	return decodeQuestionVersion(raw)
}

func (repository *Postgres) ReplaceQuestionVersionTags(contextValue context.Context, transaction pgx.Tx, command app.ReplaceQuestionVersionTags) (app.QuestionVersion, error) {
	tags, err := json.Marshal(command.Tags)
	if err != nil {
		return app.QuestionVersion{}, fmt.Errorf("encode question tags: %w", err)
	}
	var raw json.RawMessage
	err = transaction.QueryRow(contextValue, `
		SELECT qbank.replace_question_version_tags($1, $2, $3::jsonb)
	`, command.QuestionVersionID, command.ExpectedQuestionVersion, tags).Scan(&raw)
	if err != nil {
		return app.QuestionVersion{}, mapCommandError(err, "replace question tags")
	}
	return decodeQuestionVersion(raw)
}

func (repository *Postgres) PublishQuestionVersion(contextValue context.Context, transaction pgx.Tx, command app.PublishQuestionVersion) (app.QuestionDetail, error) {
	var raw json.RawMessage
	err := transaction.QueryRow(contextValue, `
		SELECT qbank.publish_question_version($1, $2, $3)
	`, command.QuestionVersionID, command.EventID, command.ExpectedQuestionVersion).Scan(&raw)
	if err != nil {
		return app.QuestionDetail{}, mapCommandError(err, "publish question version")
	}
	return decodeQuestionDetail(raw)
}

func (repository *Postgres) ArchiveQuestion(contextValue context.Context, transaction pgx.Tx, command app.ArchiveQuestion) (app.QuestionDetail, error) {
	var raw json.RawMessage
	err := transaction.QueryRow(contextValue, `
		SELECT qbank.archive_question($1, $2, $3)
	`, command.QuestionID, command.EventID, command.ExpectedQuestionRevision).Scan(&raw)
	if err != nil {
		return app.QuestionDetail{}, mapCommandError(err, "archive question")
	}
	return decodeQuestionDetail(raw)
}

func (repository *Postgres) GetPublishedQuestion(contextValue context.Context, transaction pgx.Tx, questionID string) (app.QuestionDetail, error) {
	var raw json.RawMessage
	if err := transaction.QueryRow(contextValue, `SELECT qbank.get_published_question($1)`, questionID).Scan(&raw); err != nil {
		return app.QuestionDetail{}, mapCommandError(err, "get published question")
	}
	return decodeQuestionDetail(raw)
}

func (repository *Postgres) GetQuestionVersion(contextValue context.Context, transaction pgx.Tx, questionVersionID string) (app.QuestionVersion, error) {
	var raw json.RawMessage
	if err := transaction.QueryRow(contextValue, `SELECT qbank.get_question_version($1)`, questionVersionID).Scan(&raw); err != nil {
		return app.QuestionVersion{}, mapCommandError(err, "get question version")
	}
	return decodeQuestionVersion(raw)
}

func (repository *Postgres) ListPublishedQuestions(contextValue context.Context, transaction pgx.Tx, limit int) ([]app.QuestionDetail, error) {
	var raw json.RawMessage
	if err := transaction.QueryRow(contextValue, `SELECT qbank.list_published_questions($1)`, limit).Scan(&raw); err != nil {
		return nil, mapCommandError(err, "list published questions")
	}
	var questions []app.QuestionDetail
	if err := json.Unmarshal(raw, &questions); err != nil {
		return nil, fmt.Errorf("decode published question list: %w", err)
	}
	return questions, nil
}

func encodedVersionParts(content app.VersionContent) ([]byte, []byte, error) {
	languages, err := json.Marshal(content.SupportedLanguages)
	if err != nil {
		return nil, nil, fmt.Errorf("encode supported languages: %w", err)
	}
	tags, err := json.Marshal(content.Tags)
	if err != nil {
		return nil, nil, fmt.Errorf("encode question tags: %w", err)
	}
	return languages, tags, nil
}

func (repository *Postgres) GetQuestionIncludeDeleted(contextValue context.Context, transaction pgx.Tx, questionID string) (app.Question, error) {
	var question app.Question
	err := transaction.QueryRow(contextValue, `
		SELECT id, slug, lifecycle_state, created_at, archived_at, version
		FROM qbank.questions WHERE id = $1
	`, questionID).Scan(&question.ID, &question.Slug, &question.LifecycleState,
		&question.CreatedAt, &question.ArchivedAt, &question.Version)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Question{}, apperrors.New(apperrors.CodeNotFound, "question was not found")
	}
	if err != nil {
		return app.Question{}, fmt.Errorf("read question: %w", err)
	}
	return question, nil
}

func (repository *Postgres) GetQuestionVersionIncludeDeleted(contextValue context.Context, transaction pgx.Tx, questionVersionID string) (app.QuestionVersion, error) {
	var version app.QuestionVersion
	var tagsJSON json.RawMessage
	err := transaction.QueryRow(contextValue, `
		SELECT id, question_id, version_number, title, prompt_markdown, difficulty,
		       supported_languages, time_limit_ms, memory_limit_kib, status, published_at,
		       created_at, version, tags, sample_test_case_count, hidden_test_case_count, asset_count
		FROM qbank.question_versions WHERE id = $1
	`, questionVersionID).Scan(&version.ID, &version.QuestionID, &version.VersionNumber, &version.Title,
		&version.PromptMarkdown, &version.Difficulty, &version.SupportedLanguages, &version.TimeLimitMS,
		&version.MemoryLimitKiB, &version.Status, &version.PublishedAt, &version.CreatedAt, &version.Version,
		&tagsJSON, &version.SampleTestCaseCount, &version.HiddenTestCaseCount, &version.AssetCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.QuestionVersion{}, apperrors.New(apperrors.CodeNotFound, "question version was not found")
	}
	if err != nil {
		return app.QuestionVersion{}, fmt.Errorf("read question version: %w", err)
	}
	if err := json.Unmarshal(tagsJSON, &version.Tags); err != nil {
		return app.QuestionVersion{}, fmt.Errorf("decode tags: %w", err)
	}
	return version, nil
}

func (repository *Postgres) SoftDeleteQuestion(contextValue context.Context, transaction pgx.Tx, command app.DeleteQuestion) error {
	result, err := transaction.Exec(contextValue, `
		UPDATE qbank.questions
		SET deleted_at = clock_timestamp(), deleted_by = $2, deletion_reason = $3, updated_at = clock_timestamp()
		WHERE id = $1 AND deleted_at IS NULL
	`, command.ID, command.ActorID, command.Reason)
	if err != nil {
		return fmt.Errorf("soft delete question: %w", err)
	}
	if result.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "question not found or already deleted")
	}
	return nil
}

func (repository *Postgres) HardDeleteQuestion(contextValue context.Context, transaction pgx.Tx, command app.DeleteQuestion) error {
	var success bool
	err := transaction.QueryRow(contextValue, `
		SELECT app.hard_delete('qbank.questions', $1::uuid, $2::uuid, $3)
	`, command.ID, command.ActorID, command.Reason).Scan(&success)
	if err != nil {
		return fmt.Errorf("hard delete question: %w", err)
	}
	if !success {
		return apperrors.New(apperrors.CodeNotFound, "question not found or insufficient permissions")
	}
	return nil
}

func (repository *Postgres) SoftDeleteQuestionVersion(contextValue context.Context, transaction pgx.Tx, command app.DeleteQuestionVersion) error {
	result, err := transaction.Exec(contextValue, `
		UPDATE qbank.question_versions
		SET deleted_at = clock_timestamp(), deleted_by = $2, deletion_reason = $3, updated_at = clock_timestamp()
		WHERE id = $1 AND deleted_at IS NULL
	`, command.ID, command.ActorID, command.Reason)
	if err != nil {
		return fmt.Errorf("soft delete question version: %w", err)
	}
	if result.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "question version not found or already deleted")
	}
	return nil
}

func (repository *Postgres) HardDeleteQuestionVersion(contextValue context.Context, transaction pgx.Tx, command app.DeleteQuestionVersion) error {
	var success bool
	err := transaction.QueryRow(contextValue, `
		SELECT app.hard_delete('qbank.question_versions', $1::uuid, $2::uuid, $3)
	`, command.ID, command.ActorID, command.Reason).Scan(&success)
	if err != nil {
		return fmt.Errorf("hard delete question version: %w", err)
	}
	if !success {
		return apperrors.New(apperrors.CodeNotFound, "question version not found or insufficient permissions")
	}
	return nil
}

func decodeQuestionDetail(raw json.RawMessage) (app.QuestionDetail, error) {
	var detail app.QuestionDetail
	if err := json.Unmarshal(raw, &detail); err != nil {
		return app.QuestionDetail{}, fmt.Errorf("decode question response: %w", err)
	}
	return detail, nil
}

func decodeQuestionVersion(raw json.RawMessage) (app.QuestionVersion, error) {
	var version app.QuestionVersion
	if err := json.Unmarshal(raw, &version); err != nil {
		return app.QuestionVersion{}, fmt.Errorf("decode question version response: %w", err)
	}
	return version, nil
}

func mapCommandError(err error, operation string) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		switch postgresError.Code {
		case "P0002":
			return apperrors.New(apperrors.CodeNotFound, "question resource was not found")
		case "42501":
			return apperrors.New(apperrors.CodeForbidden, "authorization context does not permit this operation")
		case "23505", "40001", "55000":
			return apperrors.New(apperrors.CodeConflict, "question resource changed or conflicts with an immutable state")
		case "22023", "22P02", "23514":
			return apperrors.New(apperrors.CodeInvalidArgument, "question command is invalid")
		}
	}
	return fmt.Errorf("%s: %w", operation, err)
}
