package repo

import (
	"context"
	"errors"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/services/seb/internal/app"
	"github.com/jackc/pgx/v5"
)

const examPolicyColumns = `tenant_id::text, exam_id::text, title, enabled, accepted_keys,
	updated_by::text, updated_at, version`

func scanExamPolicy(row pgx.Row) (app.ExamPolicy, error) {
	var policy app.ExamPolicy
	err := row.Scan(&policy.TenantID, &policy.ExamID, &policy.Title, &policy.Enabled, &policy.AcceptedKeys,
		&policy.UpdatedBy, &policy.UpdatedAt, &policy.Version)
	return policy, err
}

func (repository *Postgres) PutExamPolicy(ctx context.Context, transaction pgx.Tx, command app.PutExamPolicy) (app.ExamPolicy, error) {
	policy, err := scanExamPolicy(transaction.QueryRow(ctx, `
		INSERT INTO seb.exam_policies AS existing (tenant_id, exam_id, title, enabled, accepted_keys, updated_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (tenant_id, exam_id) DO UPDATE
		SET title = EXCLUDED.title, enabled = EXCLUDED.enabled, accepted_keys = EXCLUDED.accepted_keys,
		    updated_by = EXCLUDED.updated_by, updated_at = clock_timestamp(), version = existing.version + 1
		RETURNING `+examPolicyColumns,
		command.TenantID, command.ExamID, command.Title, command.Enabled, command.AcceptedKeys, command.ActorID))
	if err != nil {
		return app.ExamPolicy{}, mapWriteError(err, "SEB exam policy is invalid")
	}
	return policy, nil
}

func (repository *Postgres) GetExamPolicy(ctx context.Context, transaction pgx.Tx, tenantID, examID string) (app.ExamPolicy, error) {
	policy, err := scanExamPolicy(transaction.QueryRow(ctx, `
		SELECT `+examPolicyColumns+` FROM seb.exam_policies WHERE tenant_id = $1 AND exam_id = $2`, tenantID, examID))
	if errors.Is(err, pgx.ErrNoRows) {
		return app.ExamPolicy{}, apperrors.New(apperrors.CodeNotFound, "this exam has no SEB policy")
	}
	if err != nil {
		return app.ExamPolicy{}, mapWriteError(err, "SEB exam policy could not be read")
	}
	return policy, nil
}

func (repository *Postgres) CheckExamRequest(ctx context.Context, transaction pgx.Tx, command app.CheckExamRequest) (string, error) {
	var result string
	err := transaction.QueryRow(ctx, `SELECT seb.check_exam_request($1, $2, NULLIF($3, ''), NULLIF($4, ''))`,
		command.TenantID, command.URL, command.RequestHash, command.ConfigKeyHash).Scan(&result)
	if err != nil {
		return "", mapWriteError(err, "SEB request check is invalid")
	}
	return result, nil
}

func (repository *Postgres) CandidateExamTitle(ctx context.Context, transaction pgx.Tx, tenantID, examID string) (string, error) {
	var title *string
	if err := transaction.QueryRow(ctx, `SELECT seb.candidate_exam_launch($1, $2)`, tenantID, examID).Scan(&title); err != nil {
		return "", mapWriteError(err, "SEB launch request is invalid")
	}
	if title == nil {
		return "", apperrors.New(apperrors.CodeNotFound, "no Safe Exam Browser exam is open for you here")
	}
	return *title, nil
}
