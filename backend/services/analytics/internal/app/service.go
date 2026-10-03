// Package app contains Analytics reporting use cases and their protected
// transaction boundaries. Analytics never reads another service database.
package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

const (
	defaultPageSize = 100
	maximumPageSize = 500
)

// StudentProgress is an event-fed aggregate over completed evaluations for a
// student/question pair. Score values stay decimal strings to preserve the
// PostgreSQL numeric representation in JSON.
type StudentProgress struct {
	TenantID       string     `json:"tenant_id"`
	StudentID      string     `json:"student_id"`
	QuestionID     string     `json:"question_id"`
	AttemptsCount  int        `json:"attempts_count"`
	AcceptedCount  int        `json:"accepted_count"`
	BestScore      string     `json:"best_score"`
	LastAttemptAt  *time.Time `json:"last_attempt_at,omitempty"`
	SourceRevision int64      `json:"source_revision"`
	ComputedAt     time.Time  `json:"computed_at"`
	Version        int64      `json:"version"`
}

// ExamResult is one immutable completed attempt represented in Analytics.
type ExamResult struct {
	TenantID              string     `json:"tenant_id"`
	ExamID                string     `json:"exam_id"`
	ExamVersionID         string     `json:"exam_version_id"`
	CandidateID           string     `json:"candidate_id"`
	CandidateAssignmentID string     `json:"candidate_assignment_id,omitempty"`
	AttemptID             string     `json:"attempt_id"`
	AttemptNumber         int        `json:"attempt_number,omitempty"`
	LifecycleState        string     `json:"lifecycle_state"`
	Score                 *string    `json:"score,omitempty"`
	MaximumScore          *string    `json:"maximum_score,omitempty"`
	SubmittedAt           *time.Time `json:"submitted_at,omitempty"`
	GradedAt              *time.Time `json:"graded_at,omitempty"`
	SourceRevision        int64      `json:"source_revision"`
	ComputedAt            time.Time  `json:"computed_at"`
	Version               int64      `json:"version"`
}

// BatchProgress is exposed even when a tenant has no event-fed student-batch
// membership rows yet; the endpoint returns an empty list instead of deriving
// a relationship from unrelated department data.
type BatchProgress struct {
	TenantID       string    `json:"tenant_id"`
	BatchID        string    `json:"batch_id"`
	ExamVersionID  string    `json:"exam_version_id"`
	AssignedCount  int       `json:"assigned_count"`
	StartedCount   int       `json:"started_count"`
	CompletedCount int       `json:"completed_count"`
	AverageScore   *string   `json:"average_score,omitempty"`
	SourceRevision int64     `json:"source_revision"`
	ComputedAt     time.Time `json:"computed_at"`
	Version        int64     `json:"version"`
}

// PlacementProgress is the latest completed result for one current student
// placement affiliation.
type PlacementProgress struct {
	TenantID              string     `json:"tenant_id"`
	PlacementDepartmentID string     `json:"placement_department_id"`
	StudentID             string     `json:"student_id"`
	HomeDepartmentID      string     `json:"home_department_id"`
	LatestExamVersionID   *string    `json:"latest_exam_version_id,omitempty"`
	LatestScore           *string    `json:"latest_score,omitempty"`
	LatestActivityAt      *time.Time `json:"latest_activity_at,omitempty"`
	SourceRevision        int64      `json:"source_revision"`
	ComputedAt            time.Time  `json:"computed_at"`
	Version               int64      `json:"version"`
}

type ReportType string

const (
	ReportStudentProgress   ReportType = "student_progress"
	ReportExamResults       ReportType = "exam_results"
	ReportBatchProgress     ReportType = "batch_progress"
	ReportPlacementProgress ReportType = "placement_progress"
)

// ReportExport is a durable request for the deployment's India-resident
// encrypted export worker. The public API never returns storage-object
// references, including after a future worker completes the workflow.
type ReportExport struct {
	ID             string          `json:"id"`
	TenantID       string          `json:"tenant_id"`
	RequestedBy    string          `json:"requested_by"`
	ReportType     ReportType      `json:"report_type"`
	Filters        json.RawMessage `json:"filters"`
	LifecycleState string          `json:"lifecycle_state"`
	ObjectKey      *string         `json:"object_key,omitempty"`
	Checksum       *string         `json:"checksum,omitempty"`
	RequestedAt    time.Time       `json:"requested_at"`
	CompletedAt    *time.Time      `json:"completed_at,omitempty"`
	ExpiresAt      time.Time       `json:"expires_at"`
	RetentionUntil time.Time       `json:"retention_until"`
	LegalHold      bool            `json:"legal_hold"`
	Version        int64           `json:"version"`
	DeletedAt      *time.Time      `json:"deleted_at,omitempty"`
	DeletedBy      *string         `json:"deleted_by,omitempty"`
	DeletionReason *string         `json:"deletion_reason,omitempty"`
}

type RequestReportExport struct {
	ID             string
	EventID        string
	TenantID       string
	ReportType     ReportType
	Filters        json.RawMessage
	IdempotencyKey string
	RequestHash    string
}

// DeleteReportExport is the command for soft/hard delete operations.
type DeleteReportExport struct {
	ID       string
	TenantID string
	ActorID  string
	Reason   string
}

// Store is implemented by the service-local PostgreSQL adapter. Ordinary
// reporting reads receive the signed GORM transaction; immutable workflow
// functions keep the pgx transaction required by the database contract.
type Store interface {
	ListStudentProgress(context.Context, *database.GormDB, string, string, int) ([]StudentProgress, error)
	ListExamResults(context.Context, *database.GormDB, string, string, int) ([]ExamResult, error)
	ListBatchProgress(context.Context, *database.GormDB, string, string, int) ([]BatchProgress, error)
	ListPlacementProgress(context.Context, *database.GormDB, string, string, int) ([]PlacementProgress, error)
	GetReportExport(context.Context, pgx.Tx, string, string) (ReportExport, error)
	RequestReportExport(context.Context, pgx.Tx, RequestReportExport) (ReportExport, error)
	SoftDeleteReportExport(context.Context, pgx.Tx, DeleteReportExport) error
	HardDeleteReportExport(context.Context, pgx.Tx, DeleteReportExport) error
	Ping(context.Context) error
}

type Service struct {
	pool        *pgxpool.Pool
	orm         *database.ORM
	store       Store
	idempotency *database.IdempotencyStore
	now         func() time.Time
}

func NewService(pool *pgxpool.Pool, orm *database.ORM, store Store) (*Service, error) {
	if pool == nil || orm == nil || store == nil {
		return nil, fmt.Errorf("analytics database pool, ORM, and store are required")
	}
	idempotency, err := database.NewIdempotencyStore("app.idempotency_keys")
	if err != nil {
		return nil, err
	}
	return &Service{pool: pool, orm: orm, store: store, idempotency: idempotency, now: time.Now}, nil
}

func (service *Service) ListStudentProgress(ctx context.Context, capability centralauthz.Capability, tenantID, studentID string, limit int) ([]StudentProgress, error) {
	if !validID(tenantID) || !validID(studentID) || !validLimit(limit) {
		return nil, invalid("student progress query is invalid")
	}
	var result []StudentProgress
	err := database.WithTenantGormTx(ctx, service.orm, capability, func(transaction *database.GormDB) error {
		var err error
		result, err = service.store.ListStudentProgress(ctx, transaction, tenantID, studentID, normalizedLimit(limit))
		return err
	})
	return result, err
}

func (service *Service) ListExamResults(ctx context.Context, capability centralauthz.Capability, tenantID, examVersionID string, limit int) ([]ExamResult, error) {
	if !validID(tenantID) || !validID(examVersionID) || !validLimit(limit) {
		return nil, invalid("exam result query is invalid")
	}
	var result []ExamResult
	err := database.WithTenantGormTx(ctx, service.orm, capability, func(transaction *database.GormDB) error {
		var err error
		result, err = service.store.ListExamResults(ctx, transaction, tenantID, examVersionID, normalizedLimit(limit))
		return err
	})
	return result, err
}

func (service *Service) ListBatchProgress(ctx context.Context, capability centralauthz.Capability, tenantID, batchID string, limit int) ([]BatchProgress, error) {
	if !validID(tenantID) || !validID(batchID) || !validLimit(limit) {
		return nil, invalid("batch progress query is invalid")
	}
	var result []BatchProgress
	err := database.WithTenantGormTx(ctx, service.orm, capability, func(transaction *database.GormDB) error {
		var err error
		result, err = service.store.ListBatchProgress(ctx, transaction, tenantID, batchID, normalizedLimit(limit))
		return err
	})
	return result, err
}

func (service *Service) ListPlacementProgress(ctx context.Context, capability centralauthz.Capability, tenantID, placementDepartmentID string, limit int) ([]PlacementProgress, error) {
	if !validID(tenantID) || !validID(placementDepartmentID) || !validLimit(limit) {
		return nil, invalid("placement progress query is invalid")
	}
	var result []PlacementProgress
	err := database.WithTenantGormTx(ctx, service.orm, capability, func(transaction *database.GormDB) error {
		var err error
		result, err = service.store.ListPlacementProgress(ctx, transaction, tenantID, placementDepartmentID, normalizedLimit(limit))
		return err
	})
	return result, err
}

func (service *Service) GetReportExport(ctx context.Context, capability centralauthz.Capability, tenantID, exportID string) (ReportExport, error) {
	if !validID(tenantID) || !validID(exportID) {
		return ReportExport{}, invalid("report export IDs are invalid")
	}
	var result ReportExport
	err := database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.GetReportExport(ctx, transaction, tenantID, exportID)
		return err
	})
	return redactReportExport(result), err
}

func (service *Service) RequestReportExport(ctx context.Context, capability centralauthz.Capability, command RequestReportExport) (ReportExport, error) {
	command.ID = strings.ToLower(strings.TrimSpace(command.ID))
	command.EventID = strings.ToLower(strings.TrimSpace(command.EventID))
	command.TenantID = strings.ToLower(strings.TrimSpace(command.TenantID))
	command.IdempotencyKey = strings.TrimSpace(command.IdempotencyKey)
	if !validID(command.ID) || !validID(command.EventID) || !validID(command.TenantID) ||
		!validReportType(command.ReportType) || len(command.IdempotencyKey) == 0 || len(command.IdempotencyKey) > 255 {
		return ReportExport{}, invalid("report export request is invalid")
	}
	filters, err := canonicalJSONObject(command.Filters)
	if err != nil {
		return ReportExport{}, err
	}
	command.Filters = filters
	if command.RequestHash == "" {
		requestBody, marshalErr := json.Marshal(struct {
			ReportType ReportType      `json:"report_type"`
			Filters    json.RawMessage `json:"filters"`
		}{ReportType: command.ReportType, Filters: filters})
		if marshalErr != nil {
			return ReportExport{}, fmt.Errorf("encode report export idempotency request: %w", marshalErr)
		}
		command.RequestHash, err = database.HashRequestBody(requestBody)
		if err != nil {
			return ReportExport{}, err
		}
	}

	var result ReportExport
	err = database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		claim, claimErr := service.idempotency.Claim(
			ctx, transaction, command.TenantID, "analytics.report_exports.create",
			command.IdempotencyKey, command.RequestHash, service.now().UTC().Add(24*time.Hour),
		)
		if claimErr != nil {
			return claimErr
		}
		if !claim.Acquired {
			if claim.State != database.IdempotencyCompleted {
				return apperrors.New(apperrors.CodeConflict, "report export request is already in progress")
			}
			if err := json.Unmarshal(claim.ResponseBody, &result); err != nil {
				return fmt.Errorf("decode durable report export response: %w", err)
			}
			// A legal hold or retention transition may have changed after the
			// first accepted request. Return current durable state rather than a
			// stale idempotency snapshot.
			result, err = service.store.GetReportExport(ctx, transaction, command.TenantID, result.ID)
			return err
		}
		created, createErr := service.store.RequestReportExport(ctx, transaction, command)
		if createErr != nil {
			return createErr
		}
		created = redactReportExport(created)
		response, marshalErr := json.Marshal(created)
		if marshalErr != nil {
			return fmt.Errorf("encode report export response: %w", marshalErr)
		}
		if completeErr := service.idempotency.Complete(
			ctx, transaction, command.TenantID, "analytics.report_exports.create",
			command.IdempotencyKey, 202, response,
		); completeErr != nil {
			return completeErr
		}
		result = created
		return nil
	})
	return redactReportExport(result), err
}

// redactReportExport makes the HTTP-facing model safe even if a future
// repository implementation is changed. Object keys and checksums are
// storage-worker metadata, not customer download URLs or public API fields.
func redactReportExport(report ReportExport) ReportExport {
	report.ObjectKey = nil
	report.Checksum = nil
	return report
}

func canonicalJSONObject(raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 || len(raw) > 64<<10 {
		return nil, invalid("report filters must be a JSON object no larger than 64 KiB")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value map[string]any
	if err := decoder.Decode(&value); err != nil || value == nil {
		return nil, invalid("report filters must be a JSON object")
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil, invalid("report filters must contain one JSON value")
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("encode report filters: %w", err)
	}
	return encoded, nil
}

// DeleteReportExportByID soft-deletes a report export with audit trail.
func (service *Service) DeleteReportExportByID(ctx context.Context, capability centralauthz.Capability, command DeleteReportExport) error {
	command.ID = strings.ToLower(strings.TrimSpace(command.ID))
	command.TenantID = strings.ToLower(strings.TrimSpace(command.TenantID))
	command.ActorID = strings.ToLower(strings.TrimSpace(command.ActorID))
	command.Reason = strings.TrimSpace(command.Reason)
	if !validID(command.ID) || !validID(command.TenantID) || !validID(command.ActorID) || command.Reason == "" {
		return invalid("report export ID, tenant ID, actor ID, and deletion reason are required")
	}
	return database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		return service.store.SoftDeleteReportExport(ctx, transaction, command)
	})
}

// HardDeleteReportExportByID permanently removes a report export (SuperAdmin only).
// Authorization is enforced by the Casbin AuthorizeHTTP call at the handler layer.
func (service *Service) HardDeleteReportExportByID(ctx context.Context, capability centralauthz.Capability, command DeleteReportExport) error {
	command.ID = strings.ToLower(strings.TrimSpace(command.ID))
	command.TenantID = strings.ToLower(strings.TrimSpace(command.TenantID))
	command.ActorID = strings.ToLower(strings.TrimSpace(command.ActorID))
	command.Reason = strings.TrimSpace(command.Reason)
	if !validID(command.ID) || !validID(command.TenantID) || !validID(command.ActorID) || command.Reason == "" {
		return invalid("report export ID, tenant ID, actor ID, and deletion reason are required")
	}
	return database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		return service.store.HardDeleteReportExport(ctx, transaction, command)
	})
}

func validID(value string) bool {
	return uuidPattern.MatchString(strings.ToLower(strings.TrimSpace(value)))
}

func validLimit(limit int) bool { return limit >= 0 && limit <= maximumPageSize }

func normalizedLimit(limit int) int {
	if limit == 0 {
		return defaultPageSize
	}
	return limit
}

func validReportType(reportType ReportType) bool {
	switch reportType {
	case ReportStudentProgress, ReportExamResults, ReportBatchProgress, ReportPlacementProgress:
		return true
	default:
		return false
	}
}

func invalid(message string) error { return apperrors.New(apperrors.CodeInvalidArgument, message) }
