// Package repo persists Assessment aggregates in its service-owned database.
package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/messaging"
	"github.com/aethercode/aethercode/services/assessment/internal/app"
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
		return nil, fmt.Errorf("assessment database pool is required")
	}
	outbox, err := messaging.NewOutboxStore(pool, "app.outbox_events")
	if err != nil {
		return nil, fmt.Errorf("initialize Assessment outbox: %w", err)
	}
	return &Postgres{pool: pool, outbox: outbox}, nil
}

func (repository *Postgres) Ping(ctx context.Context) error {
	if repository == nil || repository.pool == nil {
		return fmt.Errorf("assessment repository is not initialized")
	}
	if err := repository.pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping Assessment database: %w", err)
	}
	return nil
}

func (repository *Postgres) ClaimIdempotency(ctx context.Context, transaction pgx.Tx, claim app.IdempotencyClaim) (json.RawMessage, bool, error) {
	if transaction == nil {
		return nil, false, fmt.Errorf("idempotency transaction is required")
	}
	if _, err := transaction.Exec(ctx, `
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
		return nil, false, fmt.Errorf("purge expired Assessment idempotency records: %w", err)
	}

	var inserted bool
	err := transaction.QueryRow(ctx, `
		INSERT INTO app.idempotency_keys (
			tenant_id, operation, idempotency_key, request_hash, state, expires_at
		) VALUES ($1, $2, $3, $4, 'in_progress', clock_timestamp() + interval '24 hours')
		ON CONFLICT (scope_key, operation, idempotency_key) DO NOTHING
		RETURNING true
	`, claim.TenantID, claim.Operation, claim.Key, claim.RequestHash).Scan(&inserted)
	if err == nil && inserted {
		return nil, false, nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, false, fmt.Errorf("claim Assessment idempotency key: %w", err)
	}

	var requestHash, state string
	var response json.RawMessage
	err = transaction.QueryRow(ctx, `
		SELECT request_hash, state, response_body
		FROM app.idempotency_keys
		WHERE scope_key = $1 AND operation = $2 AND idempotency_key = $3
		FOR UPDATE
	`, claim.TenantID, claim.Operation, claim.Key).Scan(&requestHash, &state, &response)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, fmt.Errorf("assessment idempotency record disappeared")
	}
	if err != nil {
		return nil, false, fmt.Errorf("read Assessment idempotency record: %w", err)
	}
	if requestHash != claim.RequestHash {
		return nil, false, apperrors.New(apperrors.CodeConflict, "Idempotency-Key was previously used for a different request")
	}
	if state != "completed" || len(response) == 0 {
		return nil, false, apperrors.New(apperrors.CodeUnavailable, "request with this Idempotency-Key is still being processed")
	}
	return response, true, nil
}

func (repository *Postgres) CompleteIdempotency(ctx context.Context, transaction pgx.Tx, claim app.IdempotencyClaim, status int, response json.RawMessage) error {
	command, err := transaction.Exec(ctx, `
		UPDATE app.idempotency_keys
		SET state = 'completed', response_status = $5, response_body = $6,
			completed_at = clock_timestamp(), expires_at = clock_timestamp() + interval '24 hours'
		WHERE scope_key = $1 AND operation = $2 AND idempotency_key = $3
		  AND request_hash = $4 AND state = 'in_progress'
	`, claim.TenantID, claim.Operation, claim.Key, claim.RequestHash, status, response)
	if err != nil {
		return fmt.Errorf("complete Assessment idempotency record: %w", err)
	}
	if command.RowsAffected() != 1 {
		return fmt.Errorf("assessment idempotency record was not in progress")
	}
	return nil
}

func (repository *Postgres) CreateProctorPolicy(ctx context.Context, transaction pgx.Tx, command app.CreateProctorPolicy) (app.ProctorPolicy, error) {
	var policy app.ProctorPolicy
	err := transaction.QueryRow(ctx, `
		INSERT INTO assessment.proctor_policies (id, tenant_id, name, created_by)
		VALUES ($1, $2, $3, authz.current_context_actor_id())
		RETURNING id::text, tenant_id::text, name, lifecycle_state, version, created_at
	`, command.ID, command.TenantID, command.Name).Scan(
		&policy.ID, &policy.TenantID, &policy.Name, &policy.LifecycleState, &policy.Version, &policy.CreatedAt,
	)
	if err != nil {
		return app.ProctorPolicy{}, mapWriteError(err, "proctor policy could not be created")
	}
	if err := repository.enqueue(ctx, transaction, "proctor_policy", policy.ID, policy.TenantID, "assessment.proctor_policy.created.v1", struct {
		ProctorPolicyID string `json:"proctor_policy_id"`
		TenantID        string `json:"tenant_id"`
		Name            string `json:"name"`
	}{policy.ID, policy.TenantID, policy.Name}); err != nil {
		return app.ProctorPolicy{}, err
	}
	return policy, nil
}

func (repository *Postgres) CreateProctorPolicyVersion(ctx context.Context, transaction pgx.Tx, command app.CreateProctorPolicyVersion) (app.ProctorPolicyVersion, error) {
	if _, err := transaction.Exec(ctx, `
		SELECT assessment.create_proctor_policy_version($1, $2, $3, $4, $5::jsonb, $6)
	`, command.ID, command.TenantID, command.ProctorPolicyID, command.ExpectedPolicyVersion, command.Policy, command.PolicyChecksum); err != nil {
		return app.ProctorPolicyVersion{}, mapWriteError(err, "proctor policy version could not be created")
	}
	policyVersion, err := selectProctorPolicyVersion(ctx, transaction, command.ID, command.TenantID)
	if err != nil {
		return app.ProctorPolicyVersion{}, err
	}
	if err := repository.enqueue(ctx, transaction, "proctor_policy_version", policyVersion.ID, policyVersion.TenantID, "assessment.proctor_policy_version.created.v1", struct {
		ProctorPolicyVersionID string `json:"proctor_policy_version_id"`
		ProctorPolicyID        string `json:"proctor_policy_id"`
		TenantID               string `json:"tenant_id"`
		VersionNumber          int    `json:"version_number"`
		PolicyChecksum         string `json:"policy_checksum"`
	}{policyVersion.ID, policyVersion.ProctorPolicyID, policyVersion.TenantID, policyVersion.VersionNumber, policyVersion.PolicyChecksum}); err != nil {
		return app.ProctorPolicyVersion{}, err
	}
	return policyVersion, nil
}

func (repository *Postgres) PublishProctorPolicyVersion(ctx context.Context, transaction pgx.Tx, command app.PublishProctorPolicyVersion) (app.ProctorPolicyVersion, error) {
	if _, err := transaction.Exec(ctx, `
		SELECT assessment.publish_proctor_policy_version($1, $2)
	`, command.TenantID, command.ProctorPolicyVersionID); err != nil {
		return app.ProctorPolicyVersion{}, mapWriteError(err, "proctor policy version could not be published")
	}
	policyVersion, err := selectProctorPolicyVersion(ctx, transaction, command.ProctorPolicyVersionID, command.TenantID)
	if err != nil {
		return app.ProctorPolicyVersion{}, err
	}
	if err := repository.enqueue(ctx, transaction, "proctor_policy_version", policyVersion.ID, policyVersion.TenantID, "assessment.proctor_policy_version.published.v1", struct {
		ProctorPolicyVersionID string `json:"proctor_policy_version_id"`
		ProctorPolicyID        string `json:"proctor_policy_id"`
		TenantID               string `json:"tenant_id"`
		VersionNumber          int    `json:"version_number"`
		PolicyChecksum         string `json:"policy_checksum"`
	}{policyVersion.ID, policyVersion.ProctorPolicyID, policyVersion.TenantID, policyVersion.VersionNumber, policyVersion.PolicyChecksum}); err != nil {
		return app.ProctorPolicyVersion{}, err
	}
	return policyVersion, nil
}

func (repository *Postgres) CreateExam(ctx context.Context, transaction pgx.Tx, command app.CreateExam) (app.Exam, error) {
	var exam app.Exam
	err := transaction.QueryRow(ctx, `
		INSERT INTO assessment.exams (id, tenant_id, external_reference, created_by)
		VALUES ($1, $2, NULLIF($3, ''), authz.current_context_actor_id())
		RETURNING id::text, tenant_id::text, COALESCE(external_reference, ''), lifecycle_state,
		          version, created_at, updated_at
	`, command.ID, command.TenantID, command.ExternalReference).Scan(
		&exam.ID, &exam.TenantID, &exam.ExternalRef, &exam.LifecycleState, &exam.Version, &exam.CreatedAt, &exam.UpdatedAt,
	)
	if err != nil {
		return app.Exam{}, mapWriteError(err, "exam could not be created")
	}
	if err := repository.enqueue(ctx, transaction, "exam", exam.ID, exam.TenantID, "assessment.exam.created.v1", struct {
		ExamID            string `json:"exam_id"`
		TenantID          string `json:"tenant_id"`
		ExternalReference string `json:"external_reference,omitempty"`
	}{exam.ID, exam.TenantID, exam.ExternalRef}); err != nil {
		return app.Exam{}, err
	}
	return exam, nil
}

func (repository *Postgres) CreateExamVersion(ctx context.Context, transaction pgx.Tx, command app.CreateExamVersion) (app.ExamVersion, error) {
	if _, err := transaction.Exec(ctx, `
		SELECT assessment.create_exam_version($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, command.ID, command.TenantID, command.ExamID, command.ExpectedExamVersion, command.Title,
		command.InstructionsMarkdown, command.OpensAt, command.ClosesAt, command.DurationSeconds,
		command.ProctorPolicyVersionID); err != nil {
		return app.ExamVersion{}, mapWriteError(err, "exam version could not be created")
	}
	examVersion, err := selectExamVersion(ctx, transaction, command.ID, command.TenantID)
	if err != nil {
		return app.ExamVersion{}, err
	}
	if err := repository.enqueue(ctx, transaction, "exam_version", examVersion.ID, examVersion.TenantID, "assessment.exam_version.created.v1", struct {
		ExamVersionID          string `json:"exam_version_id"`
		ExamID                 string `json:"exam_id"`
		TenantID               string `json:"tenant_id"`
		VersionNumber          int    `json:"version_number"`
		ProctorPolicyVersionID string `json:"proctor_policy_version_id"`
	}{examVersion.ID, examVersion.ExamID, examVersion.TenantID, examVersion.VersionNumber, examVersion.ProctorPolicyVersionID}); err != nil {
		return app.ExamVersion{}, err
	}
	return examVersion, nil
}

func (repository *Postgres) AddExamSection(ctx context.Context, transaction pgx.Tx, command app.AddExamSection) (app.ExamSection, error) {
	if _, err := transaction.Exec(ctx, `
		SELECT assessment.add_exam_section($1, $2, $3, $4, $5, $6, $7, $8)
	`, command.ID, command.TenantID, command.ExamVersionID, command.ExpectedContentVersion,
		command.Position, command.Title, command.InstructionsMarkdown, command.TimeLimitSeconds); err != nil {
		return app.ExamSection{}, mapWriteError(err, "exam section could not be added")
	}
	section, err := selectExamSection(ctx, transaction, command.ID, command.TenantID)
	if err != nil {
		return app.ExamSection{}, err
	}
	if err := repository.enqueue(ctx, transaction, "exam_section", section.ID, section.TenantID, "assessment.exam_section.created.v1", struct {
		ExamSectionID string `json:"exam_section_id"`
		ExamVersionID string `json:"exam_version_id"`
		TenantID      string `json:"tenant_id"`
		Position      int    `json:"position"`
	}{section.ID, section.ExamVersionID, section.TenantID, section.Position}); err != nil {
		return app.ExamSection{}, err
	}
	return section, nil
}

func (repository *Postgres) AddExamItem(ctx context.Context, transaction pgx.Tx, command app.AddExamItem) (app.ExamItem, error) {
	if _, err := transaction.Exec(ctx, `
		SELECT assessment.add_exam_item($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10, $11)
	`, command.ID, command.TenantID, command.ExamVersionID, command.SectionID, command.ExpectedContentVersion,
		command.Position, command.QuestionID, command.QuestionVersionID, command.MaximumScore,
		command.EvaluationBundleObjectKey, command.EvaluationBundleChecksum); err != nil {
		return app.ExamItem{}, mapWriteError(err, "exam item could not be added")
	}
	item, err := selectExamItem(ctx, transaction, command.ID, command.TenantID)
	if err != nil {
		return app.ExamItem{}, err
	}
	if err := repository.enqueue(ctx, transaction, "exam_item", item.ID, item.TenantID, "assessment.exam_item.created.v1", struct {
		ExamItemID        string `json:"exam_item_id"`
		ExamVersionID     string `json:"exam_version_id"`
		SectionID         string `json:"section_id"`
		QuestionID        string `json:"question_id"`
		QuestionVersionID string `json:"question_version_id"`
		TenantID          string `json:"tenant_id"`
	}{item.ID, item.ExamVersionID, item.SectionID, item.QuestionID, item.QuestionVersionID, item.TenantID}); err != nil {
		return app.ExamItem{}, err
	}
	return item, nil
}

func (repository *Postgres) PublishExamVersion(ctx context.Context, transaction pgx.Tx, command app.PublishExamVersion) (app.ExamVersion, error) {
	eventID, err := database.NewUUIDv7()
	if err != nil {
		return app.ExamVersion{}, err
	}
	if _, err := transaction.Exec(ctx, `
		SELECT assessment.publish_exam_version($1, $2, $3, $4)
	`, command.TenantID, command.ExamVersionID, command.ExpectedContentVersion, eventID); err != nil {
		return app.ExamVersion{}, mapWriteError(err, "exam version could not be published")
	}
	examVersion, err := selectExamVersion(ctx, transaction, command.ExamVersionID, command.TenantID)
	if err != nil {
		return app.ExamVersion{}, err
	}
	if err := repository.enqueueWithID(ctx, transaction, eventID, "exam_version", examVersion.ID, examVersion.TenantID, "assessment.exam_version.published.v1", struct {
		ExamVersionID  string `json:"exam_version_id"`
		ExamID         string `json:"exam_id"`
		TenantID       string `json:"tenant_id"`
		VersionNumber  int    `json:"version_number"`
		ContentVersion int64  `json:"content_version"`
	}{examVersion.ID, examVersion.ExamID, examVersion.TenantID, examVersion.VersionNumber, examVersion.ContentVersion}); err != nil {
		return app.ExamVersion{}, err
	}
	return examVersion, nil
}

func (repository *Postgres) CreateAssignmentRule(ctx context.Context, transaction pgx.Tx, command app.CreateAssignmentRule) (app.AssignmentRule, error) {
	if _, err := transaction.Exec(ctx, `
		SELECT assessment.create_assignment_rule($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
	`, command.ID, command.TenantID, command.ExamVersionID, command.TargetType, command.TargetID,
		command.AvailableFrom, command.AvailableUntil, command.Accommodations); err != nil {
		return app.AssignmentRule{}, mapWriteError(err, "assignment rule could not be created")
	}
	rule, err := selectAssignmentRule(ctx, transaction, command.ID, command.TenantID)
	if err != nil {
		return app.AssignmentRule{}, err
	}
	if err := repository.enqueue(ctx, transaction, "assignment_rule", rule.ID, rule.TenantID, "assessment.assignment_rule.created.v1", struct {
		AssignmentRuleID string `json:"assignment_rule_id"`
		ExamVersionID    string `json:"exam_version_id"`
		TenantID         string `json:"tenant_id"`
		TargetType       string `json:"target_type"`
		TargetID         string `json:"target_id"`
	}{rule.ID, rule.ExamVersionID, rule.TenantID, rule.TargetType, rule.TargetID}); err != nil {
		return app.AssignmentRule{}, err
	}
	return rule, nil
}

func (repository *Postgres) MaterializeDirectCandidateAssignment(ctx context.Context, transaction pgx.Tx, command app.MaterializeDirectCandidateAssignment) (app.CandidateAssignment, error) {
	eventID, err := database.NewUUIDv7()
	if err != nil {
		return app.CandidateAssignment{}, err
	}
	if _, err := transaction.Exec(ctx, `
		SELECT assessment.materialize_direct_candidate_assignment($1, $2, $3, $4, $5)
	`, command.ID, command.TenantID, command.AssignmentRuleID, command.CandidateID, eventID); err != nil {
		return app.CandidateAssignment{}, mapWriteError(err, "candidate assignment could not be materialized")
	}
	assignment, err := selectCandidateAssignment(ctx, transaction, command.ID, command.TenantID)
	if err != nil {
		return app.CandidateAssignment{}, err
	}
	return assignment, nil
}

func (repository *Postgres) RevokeCandidateAssignment(ctx context.Context, transaction pgx.Tx, command app.RevokeCandidateAssignment) (app.CandidateAssignment, error) {
	eventID, err := database.NewUUIDv7()
	if err != nil {
		return app.CandidateAssignment{}, err
	}
	if _, err := transaction.Exec(ctx, `
		SELECT assessment.revoke_candidate_assignment($1, $2, $3, $4)
	`, command.TenantID, command.CandidateAssignmentID, command.ExpectedVersion, eventID); err != nil {
		return app.CandidateAssignment{}, mapWriteError(err, "candidate assignment could not be revoked")
	}
	assignment, err := selectCandidateAssignment(ctx, transaction, command.CandidateAssignmentID, command.TenantID)
	if err != nil {
		return app.CandidateAssignment{}, err
	}
	return assignment, nil
}

func (repository *Postgres) GetExamVersion(ctx context.Context, transaction pgx.Tx, command app.GetExamVersion) (app.ExamVersion, error) {
	return selectExamVersion(ctx, transaction, command.ExamVersionID, command.TenantID)
}

func (repository *Postgres) GetCandidateAssignment(ctx context.Context, transaction pgx.Tx, command app.GetCandidateAssignment) (app.CandidateAssignment, error) {
	return selectCandidateAssignment(ctx, transaction, command.CandidateAssignmentID, command.TenantID)
}

func (repository *Postgres) GetProctorPolicy(ctx context.Context, transaction pgx.Tx, id, tenantID string) (app.ProctorPolicy, error) {
	return selectProctorPolicy(ctx, transaction, id, tenantID)
}

func (repository *Postgres) GetProctorPolicyVersion(ctx context.Context, transaction pgx.Tx, id, tenantID string) (app.ProctorPolicyVersion, error) {
	return selectProctorPolicyVersion(ctx, transaction, id, tenantID)
}

func (repository *Postgres) ListProctorPolicies(ctx context.Context, transaction pgx.Tx, command app.ListProctorPolicies) ([]app.ProctorPolicy, error) {
	rows, err := transaction.Query(ctx, `
		SELECT id::text, tenant_id::text, name, lifecycle_state, version, created_at
		FROM assessment.proctor_policies
		WHERE tenant_id = $1
		  AND ($2::text IS NULL OR lifecycle_state = $2)
		  AND ($3::timestamptz IS NULL OR (created_at, id) < ($3, $4))
		ORDER BY created_at DESC, id DESC
		LIMIT $5
	`,
		command.TenantID, nullableText(command.LifecycleState),
		nullableTimestamp(command.CursorSort), nullableText(command.CursorID),
		command.Limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list proctor policies: %w", err)
	}
	defer rows.Close()

	policies := make([]app.ProctorPolicy, 0, command.Limit)
	for rows.Next() {
		var policy app.ProctorPolicy
		if err := rows.Scan(&policy.ID, &policy.TenantID, &policy.Name, &policy.LifecycleState,
			&policy.Version, &policy.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan proctor policy row: %w", err)
		}
		policies = append(policies, policy)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read proctor policy rows: %w", err)
	}
	return policies, nil
}

func (repository *Postgres) ListProctorPolicyVersions(ctx context.Context, transaction pgx.Tx, command app.ListProctorPolicyVersions) ([]app.ProctorPolicyVersion, error) {
	rows, err := transaction.Query(ctx, `
		SELECT id::text, tenant_id::text, proctor_policy_id::text, version_number, policy,
		       policy_checksum, status, published_at, created_at
		FROM assessment.proctor_policy_versions
		WHERE tenant_id = $1
		  AND proctor_policy_id = $2::uuid
		  AND ($3::text IS NULL OR status = $3)
		  AND ($4::bigint IS NULL OR (version_number, id) < ($4, $5::uuid))
		ORDER BY version_number DESC, id DESC
		LIMIT $6
	`,
		command.TenantID, command.ProctorPolicyID, nullableText(command.Status),
		nullableInt(command.CursorSort), nullableText(command.CursorID),
		command.Limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list proctor policy versions: %w", err)
	}
	defer rows.Close()

	versions := make([]app.ProctorPolicyVersion, 0, command.Limit)
	for rows.Next() {
		var version app.ProctorPolicyVersion
		if err := rows.Scan(
			&version.ID, &version.TenantID, &version.ProctorPolicyID, &version.VersionNumber,
			&version.Policy, &version.PolicyChecksum, &version.Status,
			&version.PublishedAt, &version.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan proctor policy version row: %w", err)
		}
		versions = append(versions, version)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read proctor policy version rows: %w", err)
	}
	return versions, nil
}

func selectProctorPolicy(ctx context.Context, transaction pgx.Tx, id, tenantID string) (app.ProctorPolicy, error) {
	var result app.ProctorPolicy
	err := transaction.QueryRow(ctx, `
		SELECT id::text, tenant_id::text, name, lifecycle_state, version, created_at
		FROM assessment.proctor_policies
		WHERE id = $1 AND tenant_id = $2
	`, id, tenantID).Scan(
		&result.ID, &result.TenantID, &result.Name, &result.LifecycleState, &result.Version, &result.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.ProctorPolicy{}, apperrors.New(apperrors.CodeNotFound, "proctor policy was not found")
	}
	if err != nil {
		return app.ProctorPolicy{}, fmt.Errorf("read proctor policy: %w", err)
	}
	return result, nil
}

func selectProctorPolicyVersion(ctx context.Context, transaction pgx.Tx, id, tenantID string) (app.ProctorPolicyVersion, error) {
	var result app.ProctorPolicyVersion
	err := transaction.QueryRow(ctx, `
		SELECT id::text, tenant_id::text, proctor_policy_id::text, version_number, policy,
		       policy_checksum, status, published_at, created_at
		FROM assessment.proctor_policy_versions
		WHERE id = $1 AND tenant_id = $2
	`, id, tenantID).Scan(
		&result.ID, &result.TenantID, &result.ProctorPolicyID, &result.VersionNumber, &result.Policy,
		&result.PolicyChecksum, &result.Status, &result.PublishedAt, &result.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.ProctorPolicyVersion{}, apperrors.New(apperrors.CodeNotFound, "proctor policy version was not found")
	}
	if err != nil {
		return app.ProctorPolicyVersion{}, fmt.Errorf("read proctor policy version: %w", err)
	}
	return result, nil
}

func selectExamVersion(ctx context.Context, transaction pgx.Tx, id, tenantID string) (app.ExamVersion, error) {
	var result app.ExamVersion
	err := transaction.QueryRow(ctx, `
		SELECT id::text, tenant_id::text, exam_id::text, version_number, content_version, attempt_limit,
		       title, instructions_markdown, opens_at, closes_at, duration_seconds,
		       proctor_policy_version_id::text, status, published_at, created_at
		FROM assessment.exam_versions
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
	`, id, tenantID).Scan(
		&result.ID, &result.TenantID, &result.ExamID, &result.VersionNumber, &result.ContentVersion, &result.AttemptLimit,
		&result.Title, &result.InstructionsMarkdown, &result.OpensAt, &result.ClosesAt, &result.DurationSeconds,
		&result.ProctorPolicyVersionID, &result.Status, &result.PublishedAt, &result.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.ExamVersion{}, apperrors.New(apperrors.CodeNotFound, "exam version was not found")
	}
	if err != nil {
		return app.ExamVersion{}, fmt.Errorf("read exam version: %w", err)
	}
	return result, nil
}

func selectExamSection(ctx context.Context, transaction pgx.Tx, id, tenantID string) (app.ExamSection, error) {
	var result app.ExamSection
	err := transaction.QueryRow(ctx, `
		SELECT id::text, tenant_id::text, exam_version_id::text, position, title,
		       instructions_markdown, time_limit_seconds, created_at
		FROM assessment.exam_sections
		WHERE id = $1 AND tenant_id = $2
	`, id, tenantID).Scan(
		&result.ID, &result.TenantID, &result.ExamVersionID, &result.Position, &result.Title,
		&result.InstructionsMarkdown, &result.TimeLimitSeconds, &result.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.ExamSection{}, apperrors.New(apperrors.CodeNotFound, "exam section was not found")
	}
	if err != nil {
		return app.ExamSection{}, fmt.Errorf("read exam section: %w", err)
	}
	return result, nil
}

func selectExamItem(ctx context.Context, transaction pgx.Tx, id, tenantID string) (app.ExamItem, error) {
	var result app.ExamItem
	err := transaction.QueryRow(ctx, `
		SELECT id::text, tenant_id::text, exam_version_id::text, section_id::text, position,
		       question_id::text, question_version_id::text, maximum_score::text,
		       evaluation_bundle_checksum, created_at
		FROM assessment.exam_items
		WHERE id = $1 AND tenant_id = $2
	`, id, tenantID).Scan(
		&result.ID, &result.TenantID, &result.ExamVersionID, &result.SectionID, &result.Position,
		&result.QuestionID, &result.QuestionVersionID, &result.MaximumScore,
		&result.EvaluationBundleChecksum, &result.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.ExamItem{}, apperrors.New(apperrors.CodeNotFound, "exam item was not found")
	}
	if err != nil {
		return app.ExamItem{}, fmt.Errorf("read exam item: %w", err)
	}
	return result, nil
}

func selectAssignmentRule(ctx context.Context, transaction pgx.Tx, id, tenantID string) (app.AssignmentRule, error) {
	var result app.AssignmentRule
	err := transaction.QueryRow(ctx, `
		SELECT id::text, tenant_id::text, exam_version_id::text, target_type, target_id::text,
		       available_from, available_until, accommodations, disabled_at, version, created_at
		FROM assessment.assignment_rules
		WHERE id = $1 AND tenant_id = $2
	`, id, tenantID).Scan(
		&result.ID, &result.TenantID, &result.ExamVersionID, &result.TargetType, &result.TargetID,
		&result.AvailableFrom, &result.AvailableUntil, &result.Accommodations, &result.DisabledAt,
		&result.Version, &result.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.AssignmentRule{}, apperrors.New(apperrors.CodeNotFound, "assignment rule was not found")
	}
	if err != nil {
		return app.AssignmentRule{}, fmt.Errorf("read assignment rule: %w", err)
	}
	return result, nil
}

func selectCandidateAssignment(ctx context.Context, transaction pgx.Tx, id, tenantID string) (app.CandidateAssignment, error) {
	var result app.CandidateAssignment
	err := transaction.QueryRow(ctx, `
		SELECT id::text, tenant_id::text, assignment_rule_id::text, exam_version_id::text,
		       candidate_id::text, available_from, available_until, lifecycle_state,
		       assigned_at, revoked_at, completed_at, version
		FROM assessment.candidate_assignments
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
	`, id, tenantID).Scan(
		&result.ID, &result.TenantID, &result.AssignmentRuleID, &result.ExamVersionID,
		&result.CandidateID, &result.AvailableFrom, &result.AvailableUntil, &result.LifecycleState,
		&result.AssignedAt, &result.RevokedAt, &result.CompletedAt, &result.Version,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.CandidateAssignment{}, apperrors.New(apperrors.CodeNotFound, "candidate assignment was not found")
	}
	if err != nil {
		return app.CandidateAssignment{}, fmt.Errorf("read candidate assignment: %w", err)
	}
	return result, nil
}

func (repository *Postgres) enqueue(ctx context.Context, transaction pgx.Tx, aggregateType, aggregateID, tenantID, eventType string, payload any) error {
	eventID, err := database.NewUUIDv7()
	if err != nil {
		return err
	}
	return repository.enqueueWithID(ctx, transaction, eventID, aggregateType, aggregateID, tenantID, eventType, payload)
}

func (repository *Postgres) enqueueWithID(ctx context.Context, transaction pgx.Tx, eventID, aggregateType, aggregateID, tenantID, eventType string, payload any) error {
	if repository == nil || repository.outbox == nil {
		return fmt.Errorf("assessment outbox is not initialized")
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode Assessment event: %w", err)
	}
	if err := repository.outbox.Enqueue(ctx, transaction, database.OutboxEvent{
		EventID: eventID, AggregateType: aggregateType, AggregateID: aggregateID,
		TenantID: tenantID, EventType: eventType, SchemaVersion: 1,
		Payload: encoded, OccurredAt: time.Now().UTC(),
	}); err != nil {
		return fmt.Errorf("enqueue Assessment domain event: %w", err)
	}
	return nil
}

func (repository *Postgres) GetExam(ctx context.Context, transaction pgx.Tx, id, tenantID string) (app.Exam, error) {
	var exam app.Exam
	err := transaction.QueryRow(ctx, `
		SELECT id::text, tenant_id::text, COALESCE(external_reference, ''), lifecycle_state,
		       version, created_at, updated_at, deleted_at, deleted_by::text, deletion_reason
		FROM assessment.exams
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
	`, id, tenantID).Scan(
		&exam.ID, &exam.TenantID, &exam.ExternalRef, &exam.LifecycleState,
		&exam.Version, &exam.CreatedAt, &exam.UpdatedAt, &exam.DeletedAt, &exam.DeletedBy, &exam.DeletionReason,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Exam{}, apperrors.New(apperrors.CodeNotFound, "exam was not found")
	}
	if err != nil {
		return app.Exam{}, fmt.Errorf("read exam: %w", err)
	}
	return exam, nil
}

func (repository *Postgres) GetExamIncludeDeleted(ctx context.Context, transaction pgx.Tx, id, tenantID string) (app.Exam, error) {
	var exam app.Exam
	err := transaction.QueryRow(ctx, `
		SELECT id::text, tenant_id::text, COALESCE(external_reference, ''), lifecycle_state,
		       version, created_at, updated_at, deleted_at, deleted_by::text, deletion_reason
		FROM assessment.exams
		WHERE id = $1 AND tenant_id = $2
	`, id, tenantID).Scan(
		&exam.ID, &exam.TenantID, &exam.ExternalRef, &exam.LifecycleState,
		&exam.Version, &exam.CreatedAt, &exam.UpdatedAt, &exam.DeletedAt, &exam.DeletedBy, &exam.DeletionReason,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Exam{}, apperrors.New(apperrors.CodeNotFound, "exam was not found")
	}
	if err != nil {
		return app.Exam{}, fmt.Errorf("read exam: %w", err)
	}
	return exam, nil
}

func (repository *Postgres) UpdateExam(ctx context.Context, transaction pgx.Tx, command app.UpdateExam) (app.Exam, error) {
	var exam app.Exam
	err := transaction.QueryRow(ctx, `
		UPDATE assessment.exams
		SET external_reference = NULLIF($3, ''),
		    updated_at = clock_timestamp(),
		    version = version + 1
		WHERE id = $1 AND tenant_id = $2
		  AND lifecycle_state = 'draft'
		  AND version = $4
		  AND deleted_at IS NULL
		RETURNING id::text, tenant_id::text, COALESCE(external_reference, ''), lifecycle_state,
		          version, created_at, updated_at
	`, command.ID, command.TenantID, command.ExternalReference, command.ExpectedVersion).Scan(
		&exam.ID, &exam.TenantID, &exam.ExternalRef, &exam.LifecycleState, &exam.Version, &exam.CreatedAt, &exam.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Exam{}, apperrors.New(apperrors.CodeConflict, "exam version is stale or exam is no longer a draft")
	}
	if err != nil {
		return app.Exam{}, fmt.Errorf("update exam: %w", err)
	}
	if err := repository.enqueue(ctx, transaction, "exam", exam.ID, exam.TenantID, "assessment.exam.updated.v1", struct {
		ExamID            string `json:"exam_id"`
		TenantID          string `json:"tenant_id"`
		ExternalReference string `json:"external_reference,omitempty"`
	}{exam.ID, exam.TenantID, exam.ExternalRef}); err != nil {
		return app.Exam{}, err
	}
	return exam, nil
}

func (repository *Postgres) SoftDeleteExam(ctx context.Context, transaction pgx.Tx, command app.DeleteExam) error {
	result, err := transaction.Exec(ctx, `
		UPDATE assessment.exams
		SET deleted_at = clock_timestamp(), deleted_by = $3::uuid, deletion_reason = $4,
		    updated_at = clock_timestamp()
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
	`, command.ID, command.TenantID, command.ActorID, command.Reason)
	if err != nil {
		return fmt.Errorf("soft delete exam: %w", err)
	}
	if result.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "exam not found or already deleted")
	}
	if err := repository.enqueue(ctx, transaction, "exam", command.ID, command.TenantID, "assessment.exam.soft_deleted.v1", struct {
		ExamID   string `json:"exam_id"`
		TenantID string `json:"tenant_id"`
		ActorID  string `json:"actor_id"`
		Reason   string `json:"reason"`
	}{command.ID, command.TenantID, command.ActorID, command.Reason}); err != nil {
		return err
	}
	return nil
}

func (repository *Postgres) HardDeleteExam(ctx context.Context, transaction pgx.Tx, command app.DeleteExam) error {
	var success bool
	err := transaction.QueryRow(ctx, `
		SELECT app.hard_delete($1, $2::uuid, $3::uuid, $4)
	`, "assessment.exams", command.ID, command.ActorID, command.Reason).Scan(&success)
	if err != nil {
		return fmt.Errorf("hard delete exam: %w", err)
	}
	if !success {
		return apperrors.New(apperrors.CodeForbidden, "hard delete denied")
	}
	if err := repository.enqueue(ctx, transaction, "exam", command.ID, command.TenantID, "assessment.exam.hard_deleted.v1", struct {
		ExamID   string `json:"exam_id"`
		TenantID string `json:"tenant_id"`
		ActorID  string `json:"actor_id"`
		Reason   string `json:"reason"`
	}{command.ID, command.TenantID, command.ActorID, command.Reason}); err != nil {
		return err
	}
	return nil
}

func (repository *Postgres) ListCandidateAssignments(ctx context.Context, transaction pgx.Tx, command app.ListCandidateAssignments) ([]app.CandidateAssignment, error) {
	var raw json.RawMessage
	err := transaction.QueryRow(ctx, `
		SELECT assessment.list_candidate_assignments($1, $2, $3, $4, $5)
	`,
		command.TenantID, command.Limit,
		nullableTimestamp(command.CursorSort), nullableText(command.CursorID),
		nullableText(command.LifecycleState),
	).Scan(&raw)
	if err != nil {
		var postgresError *pgconn.PgError
		if errors.As(err, &postgresError) && (postgresError.Code == "42501" || postgresError.Code == "28000") {
			return nil, apperrors.New(apperrors.CodeForbidden, "list candidate assignments: authorization denied")
		}
		return nil, fmt.Errorf("list candidate assignments: %w", err)
	}
	var assignments []app.CandidateAssignment
	if err := json.Unmarshal(raw, &assignments); err != nil {
		return nil, fmt.Errorf("decode candidate assignment list: %w", err)
	}
	return assignments, nil
}

func (repository *Postgres) ListExams(ctx context.Context, transaction pgx.Tx, command app.ListExams) ([]app.Exam, error) {
	rows, err := transaction.Query(ctx, `
		SELECT id::text, tenant_id::text, COALESCE(external_reference, ''), lifecycle_state,
		       version, created_at, updated_at
		FROM assessment.exams
		WHERE tenant_id = $1
		  AND deleted_at IS NULL
		  AND ($2::text IS NULL OR lifecycle_state = $2)
		  AND ($3::timestamptz IS NULL OR (created_at, id) < ($3, $4))
		ORDER BY created_at DESC, id DESC
		LIMIT $5
	`,
		command.TenantID, nullableText(command.LifecycleState),
		nullableTimestamp(command.CursorSort), nullableText(command.CursorID),
		command.Limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list exams: %w", err)
	}
	defer rows.Close()

	exams := make([]app.Exam, 0, command.Limit)
	for rows.Next() {
		var exam app.Exam
		if err := rows.Scan(&exam.ID, &exam.TenantID, &exam.ExternalRef, &exam.LifecycleState,
			&exam.Version, &exam.CreatedAt, &exam.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan exam row: %w", err)
		}
		exams = append(exams, exam)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read exam rows: %w", err)
	}
	return exams, nil
}

func (repository *Postgres) ListExamVersions(ctx context.Context, transaction pgx.Tx, command app.ListExamVersions) ([]app.ExamVersion, error) {
	rows, err := transaction.Query(ctx, `
		SELECT id::text, tenant_id::text, exam_id::text, version_number, content_version, attempt_limit,
		       title, instructions_markdown, opens_at, closes_at, duration_seconds,
		       proctor_policy_version_id::text, status, published_at, created_at
		FROM assessment.exam_versions
		WHERE tenant_id = $1
		  AND exam_id = $2::uuid
		  AND deleted_at IS NULL
		  AND ($3::text IS NULL OR status = $3)
		  AND ($4::bigint IS NULL OR (version_number, id) < ($4, $5::uuid))
		ORDER BY version_number DESC, id DESC
		LIMIT $6
	`,
		command.TenantID, command.ExamID, nullableText(command.Status),
		nullableInt(command.CursorSort), nullableText(command.CursorID),
		command.Limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list exam versions: %w", err)
	}
	defer rows.Close()

	versions := make([]app.ExamVersion, 0, command.Limit)
	for rows.Next() {
		var version app.ExamVersion
		if err := rows.Scan(
			&version.ID, &version.TenantID, &version.ExamID, &version.VersionNumber,
			&version.ContentVersion, &version.AttemptLimit, &version.Title,
			&version.InstructionsMarkdown, &version.OpensAt, &version.ClosesAt,
			&version.DurationSeconds, &version.ProctorPolicyVersionID, &version.Status,
			&version.PublishedAt, &version.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan exam version row: %w", err)
		}
		versions = append(versions, version)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read exam version rows: %w", err)
	}
	return versions, nil
}

func nullableText(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

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

func nullableInt(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return nil
	}
	return parsed
}

func mapWriteError(err error, message string) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		switch postgresError.Code {
		case "23505", "40001", "55000", "P0001":
			return apperrors.New(apperrors.CodeConflict, message)
		case "P0002":
			return apperrors.New(apperrors.CodeNotFound, message)
		case "22023", "22P02", "23503", "23514":
			return apperrors.New(apperrors.CodeInvalidArgument, message)
		case "28000", "42501":
			return apperrors.New(apperrors.CodeForbidden, "authorization denied")
		}
	}
	return fmt.Errorf("write Assessment record: %w", err)
}
