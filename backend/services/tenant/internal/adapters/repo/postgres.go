// Package repo implements Tenant's PostgreSQL persistence port.
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
	"github.com/aethercode/aethercode/services/tenant/internal/app"
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
		return nil, fmt.Errorf("tenant database pool is required")
	}
	outbox, err := messaging.NewOutboxStore(pool, "app.outbox_events")
	if err != nil {
		return nil, err
	}
	return &Postgres{pool: pool, outbox: outbox}, nil
}

func (repository *Postgres) Ping(contextValue context.Context) error {
	if err := repository.pool.Ping(contextValue); err != nil {
		return fmt.Errorf("ping Tenant database: %w", err)
	}
	return nil
}

func (repository *Postgres) ProvisionTenant(contextValue context.Context, transaction pgx.Tx, command app.ProvisionTenant) (app.Tenant, error) {
	var tenant app.Tenant
	err := transaction.QueryRow(contextValue, `
		INSERT INTO tenant.tenants (id, slug, legal_name, display_name, status)
		VALUES ($1, $2, $3, $4, 'active')
		RETURNING id, slug, legal_name, display_name, status, version, created_at
	`, command.ID, command.Slug, command.LegalName, command.DisplayName).Scan(
		&tenant.ID, &tenant.Slug, &tenant.LegalName, &tenant.DisplayName, &tenant.Status, &tenant.Version, &tenant.CreatedAt,
	)
	if err != nil {
		return app.Tenant{}, mapWriteError(err, "tenant already exists")
	}
	if _, err := transaction.Exec(contextValue, `
		INSERT INTO tenant.retention_policies (tenant_id) VALUES ($1)
	`, command.ID); err != nil {
		return app.Tenant{}, fmt.Errorf("create default retention policy: %w", err)
	}
	payload, err := json.Marshal(struct {
		TenantID string `json:"tenant_id"`
		Slug     string `json:"slug"`
	}{TenantID: tenant.ID, Slug: tenant.Slug})
	if err != nil {
		return app.Tenant{}, err
	}
	if err := repository.enqueue(contextValue, transaction, "tenant", tenant.ID, tenant.ID, "tenant.created.v1", payload); err != nil {
		return app.Tenant{}, err
	}
	return tenant, nil
}

func (repository *Postgres) GetTenant(contextValue context.Context, transaction pgx.Tx, tenantID string) (app.Tenant, error) {
	var tenant app.Tenant
	err := transaction.QueryRow(contextValue, `
		SELECT id, slug, legal_name, display_name, status, version, created_at
		FROM tenant.tenants WHERE id = $1 AND deleted_at IS NULL
	`, tenantID).Scan(&tenant.ID, &tenant.Slug, &tenant.LegalName, &tenant.DisplayName, &tenant.Status, &tenant.Version, &tenant.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Tenant{}, apperrors.New(apperrors.CodeNotFound, "tenant was not found")
	}
	if err != nil {
		return app.Tenant{}, fmt.Errorf("read tenant: %w", err)
	}
	return tenant, nil
}

func (repository *Postgres) GetTenantIncludeDeleted(contextValue context.Context, transaction pgx.Tx, tenantID string) (app.Tenant, error) {
	var tenant app.Tenant
	err := transaction.QueryRow(contextValue, `
		SELECT id, slug, legal_name, display_name, status, version, created_at
		FROM tenant.tenants WHERE id = $1
	`, tenantID).Scan(&tenant.ID, &tenant.Slug, &tenant.LegalName, &tenant.DisplayName, &tenant.Status, &tenant.Version, &tenant.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Tenant{}, apperrors.New(apperrors.CodeNotFound, "tenant was not found")
	}
	if err != nil {
		return app.Tenant{}, fmt.Errorf("read tenant: %w", err)
	}
	return tenant, nil
}

func (repository *Postgres) SoftDeleteTenant(contextValue context.Context, transaction pgx.Tx, command app.DeleteEntity) error {
	result, err := transaction.Exec(contextValue, `
		UPDATE tenant.tenants
		SET deleted_at = clock_timestamp(), deleted_by = $2, deletion_reason = $3, updated_at = clock_timestamp()
		WHERE id = $1 AND deleted_at IS NULL
	`, command.ID, command.ActorID, command.Reason)
	if err != nil {
		return fmt.Errorf("soft delete tenant: %w", err)
	}
	if result.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "tenant not found or already deleted")
	}
	payload, err := json.Marshal(struct {
		TenantID string `json:"tenant_id"`
		ActorID  string `json:"actor_id"`
		Reason   string `json:"reason"`
	}{TenantID: command.ID, ActorID: command.ActorID, Reason: command.Reason})
	if err != nil {
		return fmt.Errorf("marshal tenant soft delete payload: %w", err)
	}
	return repository.enqueue(contextValue, transaction, "tenant", command.ID, command.ID, "tenant.tenant.soft_deleted.v1", payload)
}

func (repository *Postgres) HardDeleteTenant(contextValue context.Context, transaction pgx.Tx, command app.DeleteEntity) error {
	var success bool
	err := transaction.QueryRow(contextValue, `
		SELECT app.hard_delete('tenant.tenants', $1::uuid, $2::uuid, $3)
	`, command.ID, command.ActorID, command.Reason).Scan(&success)
	if err != nil {
		return fmt.Errorf("hard delete tenant: %w", err)
	}
	if !success {
		return apperrors.New(apperrors.CodeNotFound, "tenant not found or insufficient permissions")
	}
	return nil
}

func (repository *Postgres) CreatePlacementOrganization(contextValue context.Context, transaction pgx.Tx, command app.CreatePlacementOrganization) (app.PlacementOrganization, error) {
	var organization app.PlacementOrganization
	err := transaction.QueryRow(contextValue, `
		INSERT INTO tenant.placement_organizations (id, code, legal_name)
		VALUES ($1, $2, $3)
		RETURNING id, code, legal_name, status, version, created_at
	`, command.ID, command.Code, command.LegalName).Scan(
		&organization.ID, &organization.Code, &organization.LegalName, &organization.Status, &organization.Version, &organization.CreatedAt,
	)
	if err != nil {
		return app.PlacementOrganization{}, mapWriteError(err, "placement organization already exists")
	}
	payload, err := json.Marshal(struct {
		OrganizationID string `json:"placement_organization_id"`
		Code           string `json:"code"`
	}{OrganizationID: organization.ID, Code: organization.Code})
	if err != nil {
		return app.PlacementOrganization{}, err
	}
	if err := repository.enqueue(contextValue, transaction, "placement_organization", organization.ID, "", "tenant.placement_organization.created.v1", payload); err != nil {
		return app.PlacementOrganization{}, err
	}
	return organization, nil
}

func (repository *Postgres) CreateCollegeDepartment(contextValue context.Context, transaction pgx.Tx, command app.CreateCollegeDepartment) (app.Department, error) {
	var department app.Department
	err := transaction.QueryRow(contextValue, `
		INSERT INTO tenant.departments (id, tenant_id, department_type, code, name)
		VALUES ($1, $2, 'college', $3, $4)
		RETURNING id, tenant_id::text, COALESCE(placement_organization_id::text, ''), department_type, code, name, status, version, created_at
	`, command.ID, command.TenantID, command.Code, command.Name).Scan(
		&department.ID, &department.TenantID, &department.PlacementOrganizationID, &department.DepartmentType,
		&department.Code, &department.Name, &department.Status, &department.Version, &department.CreatedAt,
	)
	if err != nil {
		return app.Department{}, mapWriteError(err, "department already exists or tenant is unavailable")
	}
	payload, err := json.Marshal(struct {
		DepartmentID string `json:"department_id"`
		TenantID     string `json:"tenant_id"`
		Type         string `json:"department_type"`
	}{DepartmentID: department.ID, TenantID: department.TenantID, Type: department.DepartmentType})
	if err != nil {
		return app.Department{}, err
	}
	if err := repository.enqueue(contextValue, transaction, "department", department.ID, department.TenantID, "tenant.department.created.v1", payload); err != nil {
		return app.Department{}, err
	}
	return department, nil
}

func (repository *Postgres) CreatePlacementDepartment(contextValue context.Context, transaction pgx.Tx, command app.CreatePlacementDepartment) (app.Department, error) {
	var department app.Department
	err := transaction.QueryRow(contextValue, `
		INSERT INTO tenant.departments (id, placement_organization_id, department_type, code, name)
		VALUES ($1, $2, 'placement', $3, $4)
		RETURNING id, COALESCE(tenant_id::text, ''), placement_organization_id::text, department_type, code, name, status, version, created_at
	`, command.ID, command.PlacementOrganizationID, command.Code, command.Name).Scan(
		&department.ID, &department.TenantID, &department.PlacementOrganizationID, &department.DepartmentType,
		&department.Code, &department.Name, &department.Status, &department.Version, &department.CreatedAt,
	)
	if err != nil {
		return app.Department{}, mapWriteError(err, "placement department already exists or organization is unavailable")
	}
	payload, err := json.Marshal(struct {
		DepartmentID            string `json:"department_id"`
		PlacementOrganizationID string `json:"placement_organization_id"`
		Type                    string `json:"department_type"`
	}{DepartmentID: department.ID, PlacementOrganizationID: department.PlacementOrganizationID, Type: department.DepartmentType})
	if err != nil {
		return app.Department{}, err
	}
	if err := repository.enqueue(contextValue, transaction, "department", department.ID, "", "tenant.placement_department.created.v1", payload); err != nil {
		return app.Department{}, err
	}
	return department, nil
}

func (repository *Postgres) CreateBatch(contextValue context.Context, transaction pgx.Tx, command app.CreateBatch) (app.Batch, error) {
	var batch app.Batch
	err := transaction.QueryRow(contextValue, `
		INSERT INTO tenant.batches (id, tenant_id, department_id, code, name, academic_year)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, tenant_id::text, department_id::text, code, name, academic_year, status, version, created_at
	`, command.ID, command.TenantID, command.DepartmentID, command.Code, command.Name, command.AcademicYear).Scan(
		&batch.ID, &batch.TenantID, &batch.DepartmentID, &batch.Code, &batch.Name, &batch.AcademicYear, &batch.Status, &batch.Version, &batch.CreatedAt,
	)
	if err != nil {
		return app.Batch{}, mapWriteError(err, "batch already exists or department is unavailable")
	}
	payload, err := json.Marshal(struct {
		BatchID      string `json:"batch_id"`
		TenantID     string `json:"tenant_id"`
		DepartmentID string `json:"department_id"`
	}{BatchID: batch.ID, TenantID: batch.TenantID, DepartmentID: batch.DepartmentID})
	if err != nil {
		return app.Batch{}, err
	}
	if err := repository.enqueue(contextValue, transaction, "batch", batch.ID, batch.TenantID, "tenant.batch.created.v1", payload); err != nil {
		return app.Batch{}, err
	}
	return batch, nil
}

func (repository *Postgres) SetRetentionPolicy(contextValue context.Context, transaction pgx.Tx, command app.SetRetentionPolicy) (app.RetentionPolicy, error) {
	var policy app.RetentionPolicy
	err := transaction.QueryRow(contextValue, `
		UPDATE tenant.retention_policies
		SET academic_records_years = $2, audit_records_years = $3, auth_logs_days = $4,
			notification_delivery_days = $5, execution_record_days = $6, version = version + 1
		WHERE tenant_id = $1
		RETURNING tenant_id::text, academic_records_years, audit_records_years, auth_logs_days,
		          notification_delivery_days, execution_record_days, version, updated_at
	`, command.TenantID, command.AcademicRecordsYears, command.AuditRecordsYears, command.AuthLogsDays,
		command.NotificationDeliveryDays, command.ExecutionRecordDays).Scan(
		&policy.TenantID, &policy.AcademicRecordsYears, &policy.AuditRecordsYears, &policy.AuthLogsDays,
		&policy.NotificationDeliveryDays, &policy.ExecutionRecordDays, &policy.Version, &policy.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.RetentionPolicy{}, apperrors.New(apperrors.CodeNotFound, "tenant retention policy was not found")
	}
	if err != nil {
		return app.RetentionPolicy{}, fmt.Errorf("update retention policy: %w", err)
	}
	payload, err := json.Marshal(struct {
		TenantID string `json:"tenant_id"`
		Version  int    `json:"version"`
	}{TenantID: policy.TenantID, Version: policy.Version})
	if err != nil {
		return app.RetentionPolicy{}, err
	}
	if err := repository.enqueue(contextValue, transaction, "retention_policy", policy.TenantID, policy.TenantID, "tenant.retention_policy.updated.v1", payload); err != nil {
		return app.RetentionPolicy{}, err
	}
	retentionPayload, err := json.Marshal(struct {
		TenantID                 string `json:"tenant_id"`
		NotificationDeliveryDays int    `json:"notification_delivery_days"`
		Version                  int    `json:"version"`
	}{
		TenantID: policy.TenantID, NotificationDeliveryDays: policy.NotificationDeliveryDays,
		Version: policy.Version,
	})
	if err != nil {
		return app.RetentionPolicy{}, err
	}
	if err := repository.enqueue(contextValue, transaction, "retention_policy", policy.TenantID, policy.TenantID, "tenant.retention_policy.updated.v2", retentionPayload); err != nil {
		return app.RetentionPolicy{}, err
	}
	return policy, nil
}

func (repository *Postgres) PlaceLegalHold(contextValue context.Context, transaction pgx.Tx, command app.PlaceLegalHold) (app.LegalHold, error) {
	var hold app.LegalHold
	err := transaction.QueryRow(contextValue, `
		INSERT INTO tenant.legal_holds (id, tenant_id, scope, subject_id, reason, placed_by_principal_id)
		VALUES ($1, $2, $3, NULLIF($4, '')::uuid, $5, $6)
		RETURNING id, tenant_id::text, scope, COALESCE(subject_id::text, ''), reason, status, placed_at, released_at
	`, command.ID, command.TenantID, command.Scope, command.SubjectID, command.Reason, command.PlacedByPrincipalID).Scan(
		&hold.ID, &hold.TenantID, &hold.Scope, &hold.SubjectID, &hold.Reason, &hold.Status, &hold.PlacedAt, &hold.ReleasedAt,
	)
	if err != nil {
		return app.LegalHold{}, mapWriteError(err, "legal hold could not be created")
	}
	payload, err := json.Marshal(struct {
		LegalHoldID string `json:"legal_hold_id"`
		TenantID    string `json:"tenant_id"`
		Scope       string `json:"scope"`
		SubjectID   string `json:"subject_id,omitempty"`
	}{LegalHoldID: hold.ID, TenantID: hold.TenantID, Scope: hold.Scope, SubjectID: hold.SubjectID})
	if err != nil {
		return app.LegalHold{}, err
	}
	if err := repository.enqueue(contextValue, transaction, "legal_hold", hold.ID, hold.TenantID, "tenant.legal_hold.placed.v1", payload); err != nil {
		return app.LegalHold{}, err
	}
	legalHoldPayload, err := json.Marshal(struct {
		LegalHoldID string `json:"legal_hold_id"`
		TenantID    string `json:"tenant_id"`
		Scope       string `json:"scope"`
		SubjectID   string `json:"subject_id,omitempty"`
		Status      string `json:"status"`
	}{
		LegalHoldID: hold.ID, TenantID: hold.TenantID, Scope: hold.Scope,
		SubjectID: hold.SubjectID, Status: hold.Status,
	})
	if err != nil {
		return app.LegalHold{}, err
	}
	if err := repository.enqueue(contextValue, transaction, "legal_hold", hold.ID, hold.TenantID, "tenant.legal_hold.placed.v2", legalHoldPayload); err != nil {
		return app.LegalHold{}, err
	}
	return hold, nil
}

func (repository *Postgres) ReleaseLegalHold(contextValue context.Context, transaction pgx.Tx, command app.ReleaseLegalHold) (app.LegalHold, error) {
	var hold app.LegalHold
	err := transaction.QueryRow(contextValue, `
		UPDATE tenant.legal_holds
		SET status = 'released', released_at = clock_timestamp(), released_by_principal_id = $3
		WHERE id = $1 AND tenant_id = $2 AND status = 'active'
		RETURNING id, tenant_id::text, scope, COALESCE(subject_id::text, ''), reason, status, placed_at, released_at
	`, command.ID, command.TenantID, command.ReleasedByPrincipalID).Scan(
		&hold.ID, &hold.TenantID, &hold.Scope, &hold.SubjectID, &hold.Reason, &hold.Status, &hold.PlacedAt, &hold.ReleasedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.LegalHold{}, apperrors.New(apperrors.CodeNotFound, "active legal hold was not found")
	}
	if err != nil {
		return app.LegalHold{}, fmt.Errorf("release legal hold: %w", err)
	}
	payload, err := json.Marshal(struct {
		LegalHoldID string `json:"legal_hold_id"`
		TenantID    string `json:"tenant_id"`
	}{LegalHoldID: hold.ID, TenantID: hold.TenantID})
	if err != nil {
		return app.LegalHold{}, err
	}
	if err := repository.enqueue(contextValue, transaction, "legal_hold", hold.ID, hold.TenantID, "tenant.legal_hold.released.v1", payload); err != nil {
		return app.LegalHold{}, err
	}
	legalHoldPayload, err := json.Marshal(struct {
		LegalHoldID string `json:"legal_hold_id"`
		TenantID    string `json:"tenant_id"`
		Scope       string `json:"scope"`
		SubjectID   string `json:"subject_id,omitempty"`
		Status      string `json:"status"`
	}{
		LegalHoldID: hold.ID, TenantID: hold.TenantID, Scope: hold.Scope,
		SubjectID: hold.SubjectID, Status: hold.Status,
	})
	if err != nil {
		return app.LegalHold{}, err
	}
	if err := repository.enqueue(contextValue, transaction, "legal_hold", hold.ID, hold.TenantID, "tenant.legal_hold.released.v2", legalHoldPayload); err != nil {
		return app.LegalHold{}, err
	}
	return hold, nil
}

func (repository *Postgres) enqueue(contextValue context.Context, transaction pgx.Tx, aggregateType, aggregateID, tenantID, eventType string, payload json.RawMessage) error {
	eventID, err := database.NewUUIDv7()
	if err != nil {
		return err
	}
	if err := repository.outbox.Enqueue(contextValue, transaction, database.OutboxEvent{
		EventID: eventID, AggregateType: aggregateType, AggregateID: aggregateID, TenantID: tenantID,
		EventType: eventType, SchemaVersion: 1, Payload: payload, OccurredAt: time.Now().UTC(),
	}); err != nil {
		return fmt.Errorf("enqueue tenant domain event: %w", err)
	}
	return nil
}

func (repository *Postgres) GetDepartment(contextValue context.Context, transaction pgx.Tx, departmentID string) (app.Department, error) {
	var department app.Department
	err := transaction.QueryRow(contextValue, `
		SELECT id, COALESCE(tenant_id::text, ''), COALESCE(placement_organization_id::text, ''),
		       department_type, code, name, status, version, created_at
		FROM tenant.departments WHERE id = $1 AND deleted_at IS NULL
	`, departmentID).Scan(&department.ID, &department.TenantID, &department.PlacementOrganizationID,
		&department.DepartmentType, &department.Code, &department.Name, &department.Status, &department.Version, &department.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Department{}, apperrors.New(apperrors.CodeNotFound, "department was not found")
	}
	if err != nil {
		return app.Department{}, fmt.Errorf("read department: %w", err)
	}
	return department, nil
}

func (repository *Postgres) GetDepartmentIncludeDeleted(contextValue context.Context, transaction pgx.Tx, departmentID string) (app.Department, error) {
	var department app.Department
	err := transaction.QueryRow(contextValue, `
		SELECT id, COALESCE(tenant_id::text, ''), COALESCE(placement_organization_id::text, ''),
		       department_type, code, name, status, version, created_at
		FROM tenant.departments WHERE id = $1
	`, departmentID).Scan(&department.ID, &department.TenantID, &department.PlacementOrganizationID,
		&department.DepartmentType, &department.Code, &department.Name, &department.Status, &department.Version, &department.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Department{}, apperrors.New(apperrors.CodeNotFound, "department was not found")
	}
	if err != nil {
		return app.Department{}, fmt.Errorf("read department: %w", err)
	}
	return department, nil
}

func (repository *Postgres) SoftDeleteDepartment(contextValue context.Context, transaction pgx.Tx, command app.DeleteEntity) error {
	var tenantID string
	err := transaction.QueryRow(contextValue, `
		UPDATE tenant.departments
		SET deleted_at = clock_timestamp(), deleted_by = $2, deletion_reason = $3, updated_at = clock_timestamp()
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING tenant_id::text
	`, command.ID, command.ActorID, command.Reason).Scan(&tenantID)
	if errors.Is(err, pgx.ErrNoRows) {
		return apperrors.New(apperrors.CodeNotFound, "department not found or already deleted")
	}
	if err != nil {
		return fmt.Errorf("soft delete department: %w", err)
	}
	payload, err := json.Marshal(struct {
		DepartmentID string `json:"department_id"`
		TenantID     string `json:"tenant_id"`
		ActorID      string `json:"actor_id"`
		Reason       string `json:"reason"`
	}{DepartmentID: command.ID, TenantID: tenantID, ActorID: command.ActorID, Reason: command.Reason})
	if err != nil {
		return fmt.Errorf("marshal department soft delete payload: %w", err)
	}
	return repository.enqueue(contextValue, transaction, "department", command.ID, tenantID, "tenant.department.soft_deleted.v1", payload)
}

func (repository *Postgres) HardDeleteDepartment(contextValue context.Context, transaction pgx.Tx, command app.DeleteEntity) error {
	var success bool
	err := transaction.QueryRow(contextValue, `
		SELECT app.hard_delete('tenant.departments', $1::uuid, $2::uuid, $3)
	`, command.ID, command.ActorID, command.Reason).Scan(&success)
	if err != nil {
		return fmt.Errorf("hard delete department: %w", err)
	}
	if !success {
		return apperrors.New(apperrors.CodeNotFound, "department not found or insufficient permissions")
	}
	return nil
}

func (repository *Postgres) GetBatch(contextValue context.Context, transaction pgx.Tx, batchID string) (app.Batch, error) {
	var batch app.Batch
	err := transaction.QueryRow(contextValue, `
		SELECT id, tenant_id::text, department_id::text, code, name, academic_year, status, version, created_at
		FROM tenant.batches WHERE id = $1 AND deleted_at IS NULL
	`, batchID).Scan(&batch.ID, &batch.TenantID, &batch.DepartmentID, &batch.Code, &batch.Name,
		&batch.AcademicYear, &batch.Status, &batch.Version, &batch.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Batch{}, apperrors.New(apperrors.CodeNotFound, "batch was not found")
	}
	if err != nil {
		return app.Batch{}, fmt.Errorf("read batch: %w", err)
	}
	return batch, nil
}

func (repository *Postgres) GetBatchIncludeDeleted(contextValue context.Context, transaction pgx.Tx, batchID string) (app.Batch, error) {
	var batch app.Batch
	err := transaction.QueryRow(contextValue, `
		SELECT id, tenant_id::text, department_id::text, code, name, academic_year, status, version, created_at
		FROM tenant.batches WHERE id = $1
	`, batchID).Scan(&batch.ID, &batch.TenantID, &batch.DepartmentID, &batch.Code, &batch.Name,
		&batch.AcademicYear, &batch.Status, &batch.Version, &batch.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Batch{}, apperrors.New(apperrors.CodeNotFound, "batch was not found")
	}
	if err != nil {
		return app.Batch{}, fmt.Errorf("read batch: %w", err)
	}
	return batch, nil
}

func (repository *Postgres) SoftDeleteBatch(contextValue context.Context, transaction pgx.Tx, command app.DeleteEntity) error {
	var tenantID string
	err := transaction.QueryRow(contextValue, `
		UPDATE tenant.batches
		SET deleted_at = clock_timestamp(), deleted_by = $2, deletion_reason = $3, updated_at = clock_timestamp()
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING tenant_id::text
	`, command.ID, command.ActorID, command.Reason).Scan(&tenantID)
	if errors.Is(err, pgx.ErrNoRows) {
		return apperrors.New(apperrors.CodeNotFound, "batch not found or already deleted")
	}
	if err != nil {
		return fmt.Errorf("soft delete batch: %w", err)
	}
	payload, err := json.Marshal(struct {
		BatchID  string `json:"batch_id"`
		TenantID string `json:"tenant_id"`
		ActorID  string `json:"actor_id"`
		Reason   string `json:"reason"`
	}{BatchID: command.ID, TenantID: tenantID, ActorID: command.ActorID, Reason: command.Reason})
	if err != nil {
		return fmt.Errorf("marshal batch soft delete payload: %w", err)
	}
	return repository.enqueue(contextValue, transaction, "batch", command.ID, tenantID, "tenant.batch.soft_deleted.v1", payload)
}

func (repository *Postgres) HardDeleteBatch(contextValue context.Context, transaction pgx.Tx, command app.DeleteEntity) error {
	var success bool
	err := transaction.QueryRow(contextValue, `
		SELECT app.hard_delete('tenant.batches', $1::uuid, $2::uuid, $3)
	`, command.ID, command.ActorID, command.Reason).Scan(&success)
	if err != nil {
		return fmt.Errorf("hard delete batch: %w", err)
	}
	if !success {
		return apperrors.New(apperrors.CodeNotFound, "batch not found or insufficient permissions")
	}
	return nil
}

func (repository *Postgres) GetPlacementOrganization(contextValue context.Context, transaction pgx.Tx, organizationID string) (app.PlacementOrganization, error) {
	var organization app.PlacementOrganization
	err := transaction.QueryRow(contextValue, `
		SELECT id, code, legal_name, status, version, created_at
		FROM tenant.placement_organizations WHERE id = $1 AND deleted_at IS NULL
	`, organizationID).Scan(&organization.ID, &organization.Code, &organization.LegalName,
		&organization.Status, &organization.Version, &organization.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.PlacementOrganization{}, apperrors.New(apperrors.CodeNotFound, "placement organization was not found")
	}
	if err != nil {
		return app.PlacementOrganization{}, fmt.Errorf("read placement organization: %w", err)
	}
	return organization, nil
}

func (repository *Postgres) GetPlacementOrganizationIncludeDeleted(contextValue context.Context, transaction pgx.Tx, organizationID string) (app.PlacementOrganization, error) {
	var organization app.PlacementOrganization
	err := transaction.QueryRow(contextValue, `
		SELECT id, code, legal_name, status, version, created_at
		FROM tenant.placement_organizations WHERE id = $1
	`, organizationID).Scan(&organization.ID, &organization.Code, &organization.LegalName,
		&organization.Status, &organization.Version, &organization.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.PlacementOrganization{}, apperrors.New(apperrors.CodeNotFound, "placement organization was not found")
	}
	if err != nil {
		return app.PlacementOrganization{}, fmt.Errorf("read placement organization: %w", err)
	}
	return organization, nil
}

func (repository *Postgres) SoftDeletePlacementOrganization(contextValue context.Context, transaction pgx.Tx, command app.DeleteEntity) error {
	var rowID string
	err := transaction.QueryRow(contextValue, `
		UPDATE tenant.placement_organizations
		SET deleted_at = clock_timestamp(), deleted_by = $2, deletion_reason = $3, updated_at = clock_timestamp()
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING id::text
	`, command.ID, command.ActorID, command.Reason).Scan(&rowID)
	if errors.Is(err, pgx.ErrNoRows) {
		return apperrors.New(apperrors.CodeNotFound, "placement organization not found or already deleted")
	}
	if err != nil {
		return fmt.Errorf("soft delete placement organization: %w", err)
	}
	payload, err := json.Marshal(struct {
		PlacementOrganizationID string `json:"placement_organization_id"`
		ActorID                 string `json:"actor_id"`
		Reason                  string `json:"reason"`
	}{PlacementOrganizationID: command.ID, ActorID: command.ActorID, Reason: command.Reason})
	if err != nil {
		return fmt.Errorf("marshal placement organization soft delete payload: %w", err)
	}
	return repository.enqueue(contextValue, transaction, "placement_organization", command.ID, "", "tenant.placement_organization.soft_deleted.v1", payload)
}

func (repository *Postgres) HardDeletePlacementOrganization(contextValue context.Context, transaction pgx.Tx, command app.DeleteEntity) error {
	var success bool
	err := transaction.QueryRow(contextValue, `
		SELECT app.hard_delete('tenant.placement_organizations', $1::uuid, $2::uuid, $3)
	`, command.ID, command.ActorID, command.Reason).Scan(&success)
	if err != nil {
		return fmt.Errorf("hard delete placement organization: %w", err)
	}
	if !success {
		return apperrors.New(apperrors.CodeNotFound, "placement organization not found or insufficient permissions")
	}
	return nil
}

func (repository *Postgres) ListPlacementOrganizations(contextValue context.Context, transaction pgx.Tx, command app.ListPlacementOrganizations) ([]app.PlacementOrganization, error) {
	rows, err := transaction.Query(contextValue, `
		SELECT id::text, code, legal_name, status, version, created_at
		FROM tenant.placement_organizations
		WHERE deleted_at IS NULL
		  AND ($1::text IS NULL OR status = $1)
		  AND ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3))
		ORDER BY created_at DESC, id DESC
		LIMIT $4
	`,
		nullableText(command.Status),
		nullableTimestamp(command.CursorSort), nullableUUID(command.CursorID),
		command.Limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list placement organizations: %w", err)
	}
	defer rows.Close()

	organizations := make([]app.PlacementOrganization, 0, command.Limit)
	for rows.Next() {
		var organization app.PlacementOrganization
		if err := rows.Scan(&organization.ID, &organization.Code, &organization.LegalName,
			&organization.Status, &organization.Version, &organization.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan placement organization row: %w", err)
		}
		organizations = append(organizations, organization)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read placement organization rows: %w", err)
	}
	return organizations, nil
}

func (repository *Postgres) ListTenants(contextValue context.Context, transaction pgx.Tx, command app.ListTenants) ([]app.Tenant, error) {
	rows, err := transaction.Query(contextValue, `
		SELECT id::text, slug, legal_name, display_name, status, version, created_at
		FROM tenant.tenants
		WHERE deleted_at IS NULL
		  AND ($1::text IS NULL OR status = $1)
		  AND ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3))
		ORDER BY created_at DESC, id DESC
		LIMIT $4
	`,
		nullableText(command.Status),
		nullableTimestamp(command.CursorSort), nullableUUID(command.CursorID),
		command.Limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list tenants: %w", err)
	}
	defer rows.Close()

	tenants := make([]app.Tenant, 0, command.Limit)
	for rows.Next() {
		var tenant app.Tenant
		if err := rows.Scan(&tenant.ID, &tenant.Slug, &tenant.LegalName, &tenant.DisplayName,
			&tenant.Status, &tenant.Version, &tenant.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan tenant row: %w", err)
		}
		tenants = append(tenants, tenant)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read tenant rows: %w", err)
	}
	return tenants, nil
}

func (repository *Postgres) ListDepartments(contextValue context.Context, transaction pgx.Tx, command app.ListDepartments) ([]app.Department, error) {
	rows, err := transaction.Query(contextValue, `
		SELECT id::text, COALESCE(tenant_id::text, ''), COALESCE(placement_organization_id::text, ''),
		       department_type, code, name, status, version, created_at
		FROM tenant.departments
		WHERE tenant_id = $1
		  AND deleted_at IS NULL
		  AND ($2::text IS NULL OR status = $2)
		  AND ($3::timestamptz IS NULL OR (created_at, id) < ($3, $4))
		ORDER BY created_at DESC, id DESC
		LIMIT $5
	`,
		command.TenantID,
		nullableText(command.Status),
		nullableTimestamp(command.CursorSort), nullableUUID(command.CursorID),
		command.Limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list departments: %w", err)
	}
	defer rows.Close()

	departments := make([]app.Department, 0, command.Limit)
	for rows.Next() {
		var department app.Department
		if err := rows.Scan(&department.ID, &department.TenantID, &department.PlacementOrganizationID,
			&department.DepartmentType, &department.Code, &department.Name,
			&department.Status, &department.Version, &department.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan department row: %w", err)
		}
		departments = append(departments, department)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read department rows: %w", err)
	}
	return departments, nil
}

func (repository *Postgres) ListPlacementDepartments(contextValue context.Context, transaction pgx.Tx, command app.ListPlacementDepartments) ([]app.Department, error) {
	rows, err := transaction.Query(contextValue, `
		SELECT id::text, COALESCE(tenant_id::text, ''), placement_organization_id::text,
		       department_type, code, name, status, version, created_at
		FROM tenant.departments
		WHERE placement_organization_id = $1
		  AND deleted_at IS NULL
		  AND ($2::text IS NULL OR status = $2)
		  AND ($3::timestamptz IS NULL OR (created_at, id) < ($3, $4))
		ORDER BY created_at DESC, id DESC
		LIMIT $5
	`,
		command.OrganizationID,
		nullableText(command.Status),
		nullableTimestamp(command.CursorSort), nullableUUID(command.CursorID),
		command.Limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list placement departments: %w", err)
	}
	defer rows.Close()

	departments := make([]app.Department, 0, command.Limit)
	for rows.Next() {
		var department app.Department
		if err := rows.Scan(&department.ID, &department.TenantID, &department.PlacementOrganizationID,
			&department.DepartmentType, &department.Code, &department.Name,
			&department.Status, &department.Version, &department.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan placement department row: %w", err)
		}
		departments = append(departments, department)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read placement department rows: %w", err)
	}
	return departments, nil
}

func (repository *Postgres) ListBatches(contextValue context.Context, transaction pgx.Tx, command app.ListBatches) ([]app.Batch, error) {
	rows, err := transaction.Query(contextValue, `
		SELECT id::text, tenant_id::text, department_id::text, code, name,
		       academic_year, status, version, created_at
		FROM tenant.batches
		WHERE tenant_id = $1
		  AND deleted_at IS NULL
		  AND ($2::uuid IS NULL OR department_id = $2)
		  AND ($3::text IS NULL OR status = $3)
		  AND ($4::text IS NULL OR academic_year = $4)
		  AND ($5::timestamptz IS NULL OR (created_at, id) < ($5, $6))
		ORDER BY created_at DESC, id DESC
		LIMIT $7
	`,
		command.TenantID, nullableUUID(command.DepartmentID),
		nullableText(command.Status), nullableText(command.AcademicYear),
		nullableTimestamp(command.CursorSort), nullableUUID(command.CursorID),
		command.Limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list batches: %w", err)
	}
	defer rows.Close()

	batches := make([]app.Batch, 0, command.Limit)
	for rows.Next() {
		var batch app.Batch
		if err := rows.Scan(&batch.ID, &batch.TenantID, &batch.DepartmentID, &batch.Code,
			&batch.Name, &batch.AcademicYear, &batch.Status, &batch.Version,
			&batch.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan batch row: %w", err)
		}
		batches = append(batches, batch)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read batch rows: %w", err)
	}
	return batches, nil
}

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

func mapWriteError(err error, conflictMessage string) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		switch postgresError.Code {
		case "23505":
			return apperrors.New(apperrors.CodeConflict, conflictMessage)
		case "23503", "23514":
			return apperrors.New(apperrors.CodeInvalidArgument, conflictMessage)
		}
	}
	return fmt.Errorf("write tenant record: %w", err)
}
