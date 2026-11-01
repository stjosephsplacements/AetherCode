package repo

import (
	"context"

	"github.com/aethercode/aethercode/services/assessment/internal/app"
	"github.com/jackc/pgx/v5"
)

func (repository *Postgres) UpdateExamVersion(ctx context.Context, transaction pgx.Tx, command app.UpdateExamVersion) error {
	if _, err := transaction.Exec(ctx, `
		SELECT assessment.update_exam_version($1, $2, $3, $4, $5, $6, $7, $8)
	`, command.ID, command.TenantID, command.ExpectedContentVersion, command.Title, command.InstructionsMarkdown, command.OpensAt, command.ClosesAt, command.DurationSeconds); err != nil {
		return mapWriteError(err, "exam could not be updated")
	}
	return repository.enqueue(ctx, transaction, "exam_version", command.ID, command.TenantID, "assessment.exam_version.updated.v1", struct {
		ExamVersionID string `json:"exam_version_id"`
		TenantID      string `json:"tenant_id"`
	}{command.ID, command.TenantID})
}

func (repository *Postgres) UpdateExamSection(ctx context.Context, transaction pgx.Tx, command app.UpdateExamSection) error {
	if _, err := transaction.Exec(ctx, `
		SELECT assessment.update_exam_section($1, $2, $3, $4, $5, $6, $7, $8)
	`, command.ID, command.TenantID, command.ExamVersionID, command.ExpectedContentVersion, command.Title, command.InstructionsMarkdown, command.TimeLimitSeconds, command.ClearTimeLimit); err != nil {
		return mapWriteError(err, "exam section could not be updated")
	}
	return repository.enqueue(ctx, transaction, "exam_section", command.ID, command.TenantID, "assessment.exam_section.updated.v1", struct {
		ExamSectionID string `json:"exam_section_id"`
		ExamVersionID string `json:"exam_version_id"`
		TenantID      string `json:"tenant_id"`
	}{command.ID, command.ExamVersionID, command.TenantID})
}

func (repository *Postgres) UpdateExamItem(ctx context.Context, transaction pgx.Tx, command app.UpdateExamItem) error {
	if _, err := transaction.Exec(ctx, `
		SELECT assessment.update_exam_item($1, $2, $3, $4, $5::numeric)
	`, command.ID, command.TenantID, command.ExamVersionID, command.ExpectedContentVersion, command.MaximumScore); err != nil {
		return mapWriteError(err, "exam item could not be updated")
	}
	return repository.enqueue(ctx, transaction, "exam_item", command.ID, command.TenantID, "assessment.exam_item.updated.v1", struct {
		ExamItemID    string `json:"exam_item_id"`
		ExamVersionID string `json:"exam_version_id"`
		TenantID      string `json:"tenant_id"`
	}{command.ID, command.ExamVersionID, command.TenantID})
}
