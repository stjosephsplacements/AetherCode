// Package app contains Tenant's transaction-scoped business workflows.
package app

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	slugPattern          = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,62}$`)
	collegeCodePattern   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$`)
	placementCodePattern = regexp.MustCompile(`^[A-Z0-9][A-Z0-9-]{1,62}$`)
	yearPattern          = regexp.MustCompile(`^[0-9]{4}-[0-9]{4}$`)
)

// Store is implemented by the PostgreSQL adapter. Every operation receives the
// caller's already authorized transaction; adapters never open an unscoped
// application transaction on their own.
type Store interface {
	ProvisionTenant(context.Context, pgx.Tx, ProvisionTenant) (Tenant, error)
	GetTenant(context.Context, pgx.Tx, string) (Tenant, error)
	GetTenantIncludeDeleted(context.Context, pgx.Tx, string) (Tenant, error)
	SoftDeleteTenant(context.Context, pgx.Tx, DeleteEntity) error
	HardDeleteTenant(context.Context, pgx.Tx, DeleteEntity) error
	CreatePlacementOrganization(context.Context, pgx.Tx, CreatePlacementOrganization) (PlacementOrganization, error)
	GetPlacementOrganization(context.Context, pgx.Tx, string) (PlacementOrganization, error)
	GetPlacementOrganizationIncludeDeleted(context.Context, pgx.Tx, string) (PlacementOrganization, error)
	SoftDeletePlacementOrganization(context.Context, pgx.Tx, DeleteEntity) error
	HardDeletePlacementOrganization(context.Context, pgx.Tx, DeleteEntity) error
	CreateCollegeDepartment(context.Context, pgx.Tx, CreateCollegeDepartment) (Department, error)
	CreatePlacementDepartment(context.Context, pgx.Tx, CreatePlacementDepartment) (Department, error)
	GetDepartment(context.Context, pgx.Tx, string) (Department, error)
	GetDepartmentIncludeDeleted(context.Context, pgx.Tx, string) (Department, error)
	SoftDeleteDepartment(context.Context, pgx.Tx, DeleteEntity) error
	HardDeleteDepartment(context.Context, pgx.Tx, DeleteEntity) error
	CreateBatch(context.Context, pgx.Tx, CreateBatch) (Batch, error)
	GetBatch(context.Context, pgx.Tx, string) (Batch, error)
	GetBatchIncludeDeleted(context.Context, pgx.Tx, string) (Batch, error)
	SoftDeleteBatch(context.Context, pgx.Tx, DeleteEntity) error
	HardDeleteBatch(context.Context, pgx.Tx, DeleteEntity) error
	SetRetentionPolicy(context.Context, pgx.Tx, SetRetentionPolicy) (RetentionPolicy, error)
	PlaceLegalHold(context.Context, pgx.Tx, PlaceLegalHold) (LegalHold, error)
	ReleaseLegalHold(context.Context, pgx.Tx, ReleaseLegalHold) (LegalHold, error)
	Ping(context.Context) error
}

type Tenant struct {
	ID          string    `json:"id"`
	Slug        string    `json:"slug"`
	LegalName   string    `json:"legal_name"`
	DisplayName string    `json:"display_name"`
	Status      string    `json:"status"`
	Version     int       `json:"version"`
	CreatedAt   time.Time `json:"created_at"`
}

type PlacementOrganization struct {
	ID        string    `json:"id"`
	Code      string    `json:"code"`
	LegalName string    `json:"legal_name"`
	Status    string    `json:"status"`
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"created_at"`
}

type Department struct {
	ID                      string    `json:"id"`
	TenantID                string    `json:"tenant_id,omitempty"`
	PlacementOrganizationID string    `json:"placement_organization_id,omitempty"`
	DepartmentType          string    `json:"department_type"`
	Code                    string    `json:"code"`
	Name                    string    `json:"name"`
	Status                  string    `json:"status"`
	Version                 int       `json:"version"`
	CreatedAt               time.Time `json:"created_at"`
}

type Batch struct {
	ID           string    `json:"id"`
	TenantID     string    `json:"tenant_id"`
	DepartmentID string    `json:"department_id"`
	Code         string    `json:"code"`
	Name         string    `json:"name"`
	AcademicYear string    `json:"academic_year"`
	Status       string    `json:"status"`
	Version      int       `json:"version"`
	CreatedAt    time.Time `json:"created_at"`
}

type RetentionPolicy struct {
	TenantID                 string    `json:"tenant_id"`
	AcademicRecordsYears     int16     `json:"academic_records_years"`
	AuditRecordsYears        int16     `json:"audit_records_years"`
	AuthLogsDays             int       `json:"auth_logs_days"`
	NotificationDeliveryDays int       `json:"notification_delivery_days"`
	ExecutionRecordDays      int       `json:"execution_record_days"`
	Version                  int       `json:"version"`
	UpdatedAt                time.Time `json:"updated_at"`
}

type LegalHold struct {
	ID         string     `json:"id"`
	TenantID   string     `json:"tenant_id"`
	Scope      string     `json:"scope"`
	SubjectID  string     `json:"subject_id,omitempty"`
	Reason     string     `json:"reason"`
	Status     string     `json:"status"`
	PlacedAt   time.Time  `json:"placed_at"`
	ReleasedAt *time.Time `json:"released_at,omitempty"`
}

type ProvisionTenant struct {
	ID          string
	Slug        string
	LegalName   string
	DisplayName string
}

type CreatePlacementOrganization struct {
	ID        string
	Code      string
	LegalName string
}

type CreateCollegeDepartment struct {
	ID       string
	TenantID string
	Code     string
	Name     string
}

type CreatePlacementDepartment struct {
	ID                      string
	PlacementOrganizationID string
	Code                    string
	Name                    string
}

type CreateBatch struct {
	ID           string
	TenantID     string
	DepartmentID string
	Code         string
	Name         string
	AcademicYear string
}

type SetRetentionPolicy struct {
	TenantID                 string
	AcademicRecordsYears     int16
	AuditRecordsYears        int16
	AuthLogsDays             int
	NotificationDeliveryDays int
	ExecutionRecordDays      int
}

type PlaceLegalHold struct {
	ID                  string
	TenantID            string
	Scope               string
	SubjectID           string
	Reason              string
	PlacedByPrincipalID string
}

type ReleaseLegalHold struct {
	ID                    string
	TenantID              string
	ReleasedByPrincipalID string
}

type DeleteEntity struct {
	ID      string
	ActorID string
	Reason  string
}

// Service owns the secure transaction boundary for Tenant workflows.
type Service struct {
	pool  *pgxpool.Pool
	store Store
}

func NewService(pool *pgxpool.Pool, store Store) (*Service, error) {
	if pool == nil || store == nil {
		return nil, fmt.Errorf("tenant database pool and store are required")
	}
	return &Service{pool: pool, store: store}, nil
}

func (service *Service) ProvisionTenant(contextValue context.Context, capability centralauthz.Capability, command ProvisionTenant) (Tenant, error) {
	command.Slug = strings.ToLower(strings.TrimSpace(command.Slug))
	command.LegalName = strings.TrimSpace(command.LegalName)
	command.DisplayName = strings.TrimSpace(command.DisplayName)
	if !slugPattern.MatchString(command.Slug) || !validText(command.LegalName, 255) || !validText(command.DisplayName, 255) {
		return Tenant{}, apperrors.New(apperrors.CodeInvalidArgument, "tenant slug and names are invalid")
	}
	var result Tenant
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.ProvisionTenant(contextValue, transaction, command)
		return err
	})
	return result, err
}

func (service *Service) GetTenant(contextValue context.Context, capability centralauthz.Capability, tenantID string) (Tenant, error) {
	if !isUUID(tenantID) {
		return Tenant{}, apperrors.New(apperrors.CodeInvalidArgument, "tenant ID must be a UUID")
	}
	var result Tenant
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.GetTenant(contextValue, transaction, tenantID)
		return err
	})
	return result, err
}

func (service *Service) CreatePlacementOrganization(contextValue context.Context, capability centralauthz.Capability, command CreatePlacementOrganization) (PlacementOrganization, error) {
	command.Code = strings.ToUpper(strings.TrimSpace(command.Code))
	command.LegalName = strings.TrimSpace(command.LegalName)
	if !placementCodePattern.MatchString(command.Code) || !validText(command.LegalName, 255) {
		return PlacementOrganization{}, apperrors.New(apperrors.CodeInvalidArgument, "placement organization code and legal name are invalid")
	}
	var result PlacementOrganization
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.CreatePlacementOrganization(contextValue, transaction, command)
		return err
	})
	return result, err
}

func (service *Service) CreateCollegeDepartment(contextValue context.Context, capability centralauthz.Capability, command CreateCollegeDepartment) (Department, error) {
	command.Code, command.Name = strings.TrimSpace(command.Code), strings.TrimSpace(command.Name)
	if !isUUID(command.TenantID) || !collegeCodePattern.MatchString(command.Code) || !validText(command.Name, 255) {
		return Department{}, apperrors.New(apperrors.CodeInvalidArgument, "college department fields are invalid")
	}
	var result Department
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.CreateCollegeDepartment(contextValue, transaction, command)
		return err
	})
	return result, err
}

func (service *Service) CreatePlacementDepartment(contextValue context.Context, capability centralauthz.Capability, command CreatePlacementDepartment) (Department, error) {
	command.Code, command.Name = strings.TrimSpace(command.Code), strings.TrimSpace(command.Name)
	if !isUUID(command.PlacementOrganizationID) || !collegeCodePattern.MatchString(command.Code) || !validText(command.Name, 255) {
		return Department{}, apperrors.New(apperrors.CodeInvalidArgument, "placement department fields are invalid")
	}
	var result Department
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.CreatePlacementDepartment(contextValue, transaction, command)
		return err
	})
	return result, err
}

func (service *Service) CreateBatch(contextValue context.Context, capability centralauthz.Capability, command CreateBatch) (Batch, error) {
	command.Code, command.Name, command.AcademicYear = strings.TrimSpace(command.Code), strings.TrimSpace(command.Name), strings.TrimSpace(command.AcademicYear)
	if !isUUID(command.TenantID) || !isUUID(command.DepartmentID) || !collegeCodePattern.MatchString(command.Code) || !validText(command.Name, 255) || !yearPattern.MatchString(command.AcademicYear) {
		return Batch{}, apperrors.New(apperrors.CodeInvalidArgument, "batch fields are invalid")
	}
	var result Batch
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.CreateBatch(contextValue, transaction, command)
		return err
	})
	return result, err
}

func (service *Service) SetRetentionPolicy(contextValue context.Context, capability centralauthz.Capability, command SetRetentionPolicy) (RetentionPolicy, error) {
	if !isUUID(command.TenantID) || command.AcademicRecordsYears < 7 || command.AcademicRecordsYears > 30 || command.AuditRecordsYears < 7 || command.AuditRecordsYears > 30 || command.AuthLogsDays < 90 || command.AuthLogsDays > 3650 || command.NotificationDeliveryDays < 30 || command.NotificationDeliveryDays > 3650 || command.ExecutionRecordDays < 1 || command.ExecutionRecordDays > 365 {
		return RetentionPolicy{}, apperrors.New(apperrors.CodeInvalidArgument, "retention policy is outside permitted bounds")
	}
	var result RetentionPolicy
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.SetRetentionPolicy(contextValue, transaction, command)
		return err
	})
	return result, err
}

func (service *Service) PlaceLegalHold(contextValue context.Context, capability centralauthz.Capability, command PlaceLegalHold) (LegalHold, error) {
	command.Scope, command.SubjectID, command.Reason = strings.TrimSpace(command.Scope), strings.TrimSpace(command.SubjectID), strings.TrimSpace(command.Reason)
	if !isUUID(command.TenantID) || !isUUID(command.PlacedByPrincipalID) || !validText(command.Reason, 2000) || (command.Scope != "tenant" && command.Scope != "student" && command.Scope != "assessment" && command.Scope != "submission") || (command.Scope == "tenant" && command.SubjectID != "") || (command.Scope != "tenant" && !isUUID(command.SubjectID)) {
		return LegalHold{}, apperrors.New(apperrors.CodeInvalidArgument, "legal hold fields are invalid")
	}
	var result LegalHold
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.PlaceLegalHold(contextValue, transaction, command)
		return err
	})
	return result, err
}

func (service *Service) ReleaseLegalHold(contextValue context.Context, capability centralauthz.Capability, command ReleaseLegalHold) (LegalHold, error) {
	if !isUUID(command.ID) || !isUUID(command.TenantID) || !isUUID(command.ReleasedByPrincipalID) {
		return LegalHold{}, apperrors.New(apperrors.CodeInvalidArgument, "legal hold release IDs are invalid")
	}
	var result LegalHold
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.ReleaseLegalHold(contextValue, transaction, command)
		return err
	})
	return result, err
}

func validText(value string, maximum int) bool {
	length := len([]rune(strings.TrimSpace(value)))
	return length > 0 && length <= maximum
}

func (service *Service) DeleteTenant(contextValue context.Context, capability centralauthz.Capability, command DeleteEntity) error {
	command.Reason = strings.TrimSpace(command.Reason)
	if !isUUID(command.ID) || !isUUID(command.ActorID) || command.Reason == "" {
		return apperrors.New(apperrors.CodeInvalidArgument, "tenant ID, actor ID, and deletion reason are required")
	}

	return database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		_, err := service.store.GetTenant(contextValue, transaction, command.ID)
		if err != nil {
			return fmt.Errorf("get tenant: %w", err)
		}

		if err := service.store.SoftDeleteTenant(contextValue, transaction, command); err != nil {
			return fmt.Errorf("soft delete tenant: %w", err)
		}

		return nil
	})
}

func (service *Service) HardDeleteTenant(contextValue context.Context, capability centralauthz.Capability, command DeleteEntity) error {
	command.Reason = strings.TrimSpace(command.Reason)
	if !isUUID(command.ID) || !isUUID(command.ActorID) || command.Reason == "" {
		return apperrors.New(apperrors.CodeInvalidArgument, "tenant ID, actor ID, and deletion reason are required")
	}

	return database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		_, err := service.store.GetTenantIncludeDeleted(contextValue, transaction, command.ID)
		if err != nil {
			return fmt.Errorf("get tenant: %w", err)
		}

		if err := service.store.HardDeleteTenant(contextValue, transaction, command); err != nil {
			return fmt.Errorf("hard delete tenant: %w", err)
		}

		return nil
	})
}

func (service *Service) DeleteDepartment(contextValue context.Context, capability centralauthz.Capability, command DeleteEntity) error {
	command.Reason = strings.TrimSpace(command.Reason)
	if !isUUID(command.ID) || !isUUID(command.ActorID) || command.Reason == "" {
		return apperrors.New(apperrors.CodeInvalidArgument, "department ID, actor ID, and deletion reason are required")
	}

	return database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		_, err := service.store.GetDepartment(contextValue, transaction, command.ID)
		if err != nil {
			return fmt.Errorf("get department: %w", err)
		}

		if err := service.store.SoftDeleteDepartment(contextValue, transaction, command); err != nil {
			return fmt.Errorf("soft delete department: %w", err)
		}

		return nil
	})
}

func (service *Service) HardDeleteDepartment(contextValue context.Context, capability centralauthz.Capability, command DeleteEntity) error {
	command.Reason = strings.TrimSpace(command.Reason)
	if !isUUID(command.ID) || !isUUID(command.ActorID) || command.Reason == "" {
		return apperrors.New(apperrors.CodeInvalidArgument, "department ID, actor ID, and deletion reason are required")
	}

	return database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		_, err := service.store.GetDepartmentIncludeDeleted(contextValue, transaction, command.ID)
		if err != nil {
			return fmt.Errorf("get department: %w", err)
		}

		if err := service.store.HardDeleteDepartment(contextValue, transaction, command); err != nil {
			return fmt.Errorf("hard delete department: %w", err)
		}

		return nil
	})
}

func (service *Service) DeleteBatch(contextValue context.Context, capability centralauthz.Capability, command DeleteEntity) error {
	command.Reason = strings.TrimSpace(command.Reason)
	if !isUUID(command.ID) || !isUUID(command.ActorID) || command.Reason == "" {
		return apperrors.New(apperrors.CodeInvalidArgument, "batch ID, actor ID, and deletion reason are required")
	}

	return database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		_, err := service.store.GetBatch(contextValue, transaction, command.ID)
		if err != nil {
			return fmt.Errorf("get batch: %w", err)
		}

		if err := service.store.SoftDeleteBatch(contextValue, transaction, command); err != nil {
			return fmt.Errorf("soft delete batch: %w", err)
		}

		return nil
	})
}

func (service *Service) HardDeleteBatch(contextValue context.Context, capability centralauthz.Capability, command DeleteEntity) error {
	command.Reason = strings.TrimSpace(command.Reason)
	if !isUUID(command.ID) || !isUUID(command.ActorID) || command.Reason == "" {
		return apperrors.New(apperrors.CodeInvalidArgument, "batch ID, actor ID, and deletion reason are required")
	}

	return database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		_, err := service.store.GetBatchIncludeDeleted(contextValue, transaction, command.ID)
		if err != nil {
			return fmt.Errorf("get batch: %w", err)
		}

		if err := service.store.HardDeleteBatch(contextValue, transaction, command); err != nil {
			return fmt.Errorf("hard delete batch: %w", err)
		}

		return nil
	})
}

func (service *Service) DeletePlacementOrganization(contextValue context.Context, capability centralauthz.Capability, command DeleteEntity) error {
	command.Reason = strings.TrimSpace(command.Reason)
	if !isUUID(command.ID) || !isUUID(command.ActorID) || command.Reason == "" {
		return apperrors.New(apperrors.CodeInvalidArgument, "placement organization ID, actor ID, and deletion reason are required")
	}

	return database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		_, err := service.store.GetPlacementOrganization(contextValue, transaction, command.ID)
		if err != nil {
			return fmt.Errorf("get placement organization: %w", err)
		}

		if err := service.store.SoftDeletePlacementOrganization(contextValue, transaction, command); err != nil {
			return fmt.Errorf("soft delete placement organization: %w", err)
		}

		return nil
	})
}

func (service *Service) HardDeletePlacementOrganization(contextValue context.Context, capability centralauthz.Capability, command DeleteEntity) error {
	command.Reason = strings.TrimSpace(command.Reason)
	if !isUUID(command.ID) || !isUUID(command.ActorID) || command.Reason == "" {
		return apperrors.New(apperrors.CodeInvalidArgument, "placement organization ID, actor ID, and deletion reason are required")
	}

	return database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		_, err := service.store.GetPlacementOrganizationIncludeDeleted(contextValue, transaction, command.ID)
		if err != nil {
			return fmt.Errorf("get placement organization: %w", err)
		}

		if err := service.store.HardDeletePlacementOrganization(contextValue, transaction, command); err != nil {
			return fmt.Errorf("hard delete placement organization: %w", err)
		}

		return nil
	})
}

func isUUID(value string) bool {
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
		if !(character >= '0' && character <= '9') && !(character >= 'a' && character <= 'f') {
			return false
		}
	}
	return true
}
