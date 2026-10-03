// Package repo implements the Analytics PostgreSQL reporting boundary.
package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/services/analytics/internal/app"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct{ pool *pgxpool.Pool }

func NewPostgres(pool *pgxpool.Pool) (*Postgres, error) {
	if pool == nil {
		return nil, fmt.Errorf("analytics database pool is required")
	}
	return &Postgres{pool: pool}, nil
}

func (repository *Postgres) Ping(ctx context.Context) error {
	if repository == nil || repository.pool == nil {
		return fmt.Errorf("analytics database repository is not initialized")
	}
	if err := repository.pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping Analytics database: %w", err)
	}
	return nil
}

// GORM models below intentionally cover only ordinary Analytics read models.
// Schema, RLS context, retention operations, and security-definer workflows
// remain migration-owned PostgreSQL concerns.
type studentProgressRow struct {
	TenantID       string     `gorm:"column:tenant_id"`
	StudentID      string     `gorm:"column:student_id"`
	QuestionID     string     `gorm:"column:question_id"`
	AttemptsCount  int        `gorm:"column:attempts_count"`
	AcceptedCount  int        `gorm:"column:accepted_count"`
	BestScore      string     `gorm:"column:best_score"`
	LastAttemptAt  *time.Time `gorm:"column:last_attempt_at"`
	SourceRevision int64      `gorm:"column:source_revision"`
	ComputedAt     time.Time  `gorm:"column:computed_at"`
	Version        int64      `gorm:"column:version"`
}

func (repository *Postgres) ListStudentProgress(ctx context.Context, tx *database.GormDB, tenantID, studentID string, limit int) ([]app.StudentProgress, error) {
	rows := make([]studentProgressRow, 0)
	result := tx.WithContext(ctx).
		Table("analytics.student_progress_rollups").
		Where(map[string]any{"tenant_id": tenantID, "student_id": studentID}).
		Order("last_attempt_at DESC NULLS LAST").
		Order("question_id ASC").
		Limit(limit).
		Find(&rows)
	if result.Error != nil {
		return nil, mapError(result.Error, "list student progress")
	}
	progress := make([]app.StudentProgress, 0, len(rows))
	for _, row := range rows {
		progress = append(progress, app.StudentProgress{
			TenantID: row.TenantID, StudentID: row.StudentID, QuestionID: row.QuestionID,
			AttemptsCount: row.AttemptsCount, AcceptedCount: row.AcceptedCount,
			BestScore: row.BestScore, LastAttemptAt: row.LastAttemptAt,
			SourceRevision: row.SourceRevision, ComputedAt: row.ComputedAt, Version: row.Version,
		})
	}
	return progress, nil
}

type examResultRow struct {
	TenantID              string     `gorm:"column:tenant_id"`
	ExamID                string     `gorm:"column:exam_id"`
	ExamVersionID         string     `gorm:"column:exam_version_id"`
	CandidateID           string     `gorm:"column:candidate_id"`
	CandidateAssignmentID *string    `gorm:"column:candidate_assignment_id"`
	AttemptID             string     `gorm:"column:attempt_id"`
	AttemptNumber         int        `gorm:"column:attempt_number"`
	LifecycleState        string     `gorm:"column:lifecycle_state"`
	Score                 *string    `gorm:"column:score"`
	MaximumScore          *string    `gorm:"column:maximum_score"`
	SubmittedAt           *time.Time `gorm:"column:submitted_at"`
	GradedAt              *time.Time `gorm:"column:graded_at"`
	SourceRevision        int64      `gorm:"column:source_revision"`
	ComputedAt            time.Time  `gorm:"column:computed_at"`
	Version               int64      `gorm:"column:version"`
}

func (repository *Postgres) ListExamResults(ctx context.Context, tx *database.GormDB, tenantID, examVersionID string, limit int) ([]app.ExamResult, error) {
	rows := make([]examResultRow, 0)
	result := tx.WithContext(ctx).
		Table("analytics.exam_result_rollups").
		Where(map[string]any{"tenant_id": tenantID, "exam_version_id": examVersionID}).
		Order("graded_at DESC NULLS LAST").
		Order("attempt_id ASC").
		Limit(limit).
		Find(&rows)
	if result.Error != nil {
		return nil, mapError(result.Error, "list exam results")
	}
	examResults := make([]app.ExamResult, 0, len(rows))
	for _, row := range rows {
		result := app.ExamResult{
			TenantID: row.TenantID, ExamID: row.ExamID, ExamVersionID: row.ExamVersionID,
			CandidateID: row.CandidateID, AttemptID: row.AttemptID, AttemptNumber: row.AttemptNumber,
			LifecycleState: row.LifecycleState, Score: row.Score, MaximumScore: row.MaximumScore,
			SubmittedAt: row.SubmittedAt, GradedAt: row.GradedAt, SourceRevision: row.SourceRevision,
			ComputedAt: row.ComputedAt, Version: row.Version,
		}
		if row.CandidateAssignmentID != nil {
			result.CandidateAssignmentID = *row.CandidateAssignmentID
		}
		examResults = append(examResults, result)
	}
	return examResults, nil
}

type batchProgressRow struct {
	TenantID       string    `gorm:"column:tenant_id"`
	BatchID        string    `gorm:"column:batch_id"`
	ExamVersionID  string    `gorm:"column:exam_version_id"`
	AssignedCount  int       `gorm:"column:assigned_count"`
	StartedCount   int       `gorm:"column:started_count"`
	CompletedCount int       `gorm:"column:completed_count"`
	AverageScore   *string   `gorm:"column:average_score"`
	SourceRevision int64     `gorm:"column:source_revision"`
	ComputedAt     time.Time `gorm:"column:computed_at"`
	Version        int64     `gorm:"column:version"`
}

func (repository *Postgres) ListBatchProgress(ctx context.Context, tx *database.GormDB, tenantID, batchID string, limit int) ([]app.BatchProgress, error) {
	rows := make([]batchProgressRow, 0)
	result := tx.WithContext(ctx).
		Table("analytics.batch_progress_rollups").
		Where(map[string]any{"tenant_id": tenantID, "batch_id": batchID}).
		Order("computed_at DESC").
		Order("exam_version_id ASC").
		Limit(limit).
		Find(&rows)
	if result.Error != nil {
		return nil, mapError(result.Error, "list batch progress")
	}
	batchProgress := make([]app.BatchProgress, 0, len(rows))
	for _, row := range rows {
		batchProgress = append(batchProgress, app.BatchProgress{
			TenantID: row.TenantID, BatchID: row.BatchID, ExamVersionID: row.ExamVersionID,
			AssignedCount: row.AssignedCount, StartedCount: row.StartedCount,
			CompletedCount: row.CompletedCount, AverageScore: row.AverageScore,
			SourceRevision: row.SourceRevision, ComputedAt: row.ComputedAt, Version: row.Version,
		})
	}
	return batchProgress, nil
}

type placementProgressRow struct {
	TenantID              string     `gorm:"column:tenant_id"`
	PlacementDepartmentID string     `gorm:"column:placement_department_id"`
	StudentID             string     `gorm:"column:student_id"`
	HomeDepartmentID      string     `gorm:"column:home_department_id"`
	LatestExamVersionID   *string    `gorm:"column:latest_exam_version_id"`
	LatestScore           *string    `gorm:"column:latest_score"`
	LatestActivityAt      *time.Time `gorm:"column:latest_activity_at"`
	SourceRevision        int64      `gorm:"column:source_revision"`
	ComputedAt            time.Time  `gorm:"column:computed_at"`
	Version               int64      `gorm:"column:version"`
}

func (repository *Postgres) ListPlacementProgress(ctx context.Context, tx *database.GormDB, tenantID, placementDepartmentID string, limit int) ([]app.PlacementProgress, error) {
	rows := make([]placementProgressRow, 0)
	result := tx.WithContext(ctx).
		Table("analytics.placement_student_rollups").
		Where(map[string]any{"tenant_id": tenantID, "placement_department_id": placementDepartmentID}).
		Order("latest_activity_at DESC NULLS LAST").
		Order("student_id ASC").
		Limit(limit).
		Find(&rows)
	if result.Error != nil {
		return nil, mapError(result.Error, "list placement progress")
	}
	placementProgress := make([]app.PlacementProgress, 0, len(rows))
	for _, row := range rows {
		placementProgress = append(placementProgress, app.PlacementProgress{
			TenantID: row.TenantID, PlacementDepartmentID: row.PlacementDepartmentID,
			StudentID: row.StudentID, HomeDepartmentID: row.HomeDepartmentID,
			LatestExamVersionID: row.LatestExamVersionID, LatestScore: row.LatestScore,
			LatestActivityAt: row.LatestActivityAt, SourceRevision: row.SourceRevision,
			ComputedAt: row.ComputedAt, Version: row.Version,
		})
	}
	return placementProgress, nil
}

func (repository *Postgres) GetReportExport(ctx context.Context, tx pgx.Tx, tenantID, exportID string) (app.ReportExport, error) {
	return scanReportExport(tx.QueryRow(ctx, `
		SELECT id::text, tenant_id::text, requested_by::text, report_type, filters,
		       lifecycle_state, NULL::text AS object_key, NULL::text AS checksum,
		       requested_at, completed_at,
		       expires_at, retention_until, legal_hold, version,
		       deleted_at, deleted_by::text, deletion_reason
		FROM analytics.report_exports
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
	`, tenantID, exportID))
}

func (repository *Postgres) RequestReportExport(ctx context.Context, tx pgx.Tx, command app.RequestReportExport) (app.ReportExport, error) {
	return scanReportExport(tx.QueryRow(ctx, `
		SELECT id::text, tenant_id::text, requested_by::text, report_type, filters,
		       lifecycle_state, NULL::text AS object_key, NULL::text AS checksum,
		       requested_at, NULL::timestamptz AS completed_at, expires_at,
		       retention_until, legal_hold, version,
		       NULL::timestamptz AS deleted_at, NULL::text AS deleted_by, NULL::text AS deletion_reason
		FROM analytics.request_report_export($1, $2, $3, $4::jsonb, $5)
	`, command.ID, command.TenantID, string(command.ReportType), string(command.Filters), command.EventID))
}

type scanner interface{ Scan(...any) error }

func scanReportExport(row scanner) (app.ReportExport, error) {
	var result app.ReportExport
	var filters []byte
	var objectKey, checksum *string
	var completedAt *time.Time
	err := row.Scan(
		&result.ID, &result.TenantID, &result.RequestedBy, &result.ReportType, &filters,
		&result.LifecycleState, &objectKey, &checksum, &result.RequestedAt, &completedAt,
		&result.ExpiresAt, &result.RetentionUntil, &result.LegalHold, &result.Version,
		&result.DeletedAt, &result.DeletedBy, &result.DeletionReason,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.ReportExport{}, apperrors.New(apperrors.CodeNotFound, "report export was not found")
	}
	if err != nil {
		return app.ReportExport{}, mapError(err, "read report export")
	}
	result.Filters = filters
	result.ObjectKey, result.Checksum, result.CompletedAt = objectKey, checksum, completedAt
	return result, nil
}

func (repository *Postgres) SoftDeleteReportExport(ctx context.Context, tx pgx.Tx, command app.DeleteReportExport) error {
	result, err := tx.Exec(ctx, `
		UPDATE analytics.report_exports
		SET deleted_at = clock_timestamp(), deleted_by = $3::uuid, deletion_reason = $4
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
	`, command.ID, command.TenantID, command.ActorID, command.Reason)
	if err != nil {
		return fmt.Errorf("soft delete report export: %w", err)
	}
	if result.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "report export not found or already deleted")
	}
	return nil
}

func (repository *Postgres) HardDeleteReportExport(ctx context.Context, tx pgx.Tx, command app.DeleteReportExport) error {
	var success bool
	err := tx.QueryRow(ctx, `
		SELECT app.hard_delete($1, $2::uuid, $3::uuid, $4)
	`, "analytics.report_exports", command.ID, command.ActorID, command.Reason).Scan(&success)
	if err != nil {
		return fmt.Errorf("hard delete report export: %w", err)
	}
	if !success {
		return apperrors.New(apperrors.CodeForbidden, "hard delete denied")
	}
	return nil
}

func mapError(err error, operation string) error {
	if database.IsORMNotFound(err) {
		return apperrors.New(apperrors.CodeNotFound, "analytics report was not found")
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return apperrors.New(apperrors.CodeNotFound, "analytics report was not found")
	}
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		switch postgresError.Code {
		case "42501", "28000":
			return apperrors.New(apperrors.CodeForbidden, "analytics authorization is no longer current")
		case "23505", "55000":
			return apperrors.New(apperrors.CodeConflict, "analytics report state changed; refresh and retry")
		case "22023", "22P02", "23514":
			return apperrors.New(apperrors.CodeInvalidArgument, "analytics request is invalid")
		}
	}
	return fmt.Errorf("%s: %w", operation, err)
}

var _ app.Store = (*Postgres)(nil)
