package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
	"github.com/stjosephsplacements/AetherCode/services/tenant/internal/app"
)

// Each update changes only the fields given (COALESCE keeps the rest), bumps
// the version and tells the outbox what changed.

func (repository *Postgres) UpdateTenant(contextValue context.Context, transaction pgx.Tx, command app.UpdateTenant) (app.Tenant, error) {
	var tenant app.Tenant
	err := transaction.QueryRow(contextValue, `
		UPDATE tenant.tenants
		SET legal_name = COALESCE($2, legal_name), display_name = COALESCE($3, display_name),
		    version = version + 1, updated_at = clock_timestamp()
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING id, slug, legal_name, display_name, status, version, created_at
	`, command.ID, command.LegalName, command.DisplayName).Scan(&tenant.ID, &tenant.Slug, &tenant.LegalName, &tenant.DisplayName, &tenant.Status, &tenant.Version, &tenant.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Tenant{}, apperrors.New(apperrors.CodeNotFound, "tenant was not found")
	}
	if err != nil {
		return app.Tenant{}, mapWriteError(err, "tenant could not be updated")
	}
	return tenant, repository.announce(contextValue, transaction, "tenant", tenant.ID, tenant.ID, "tenant.tenant.updated.v1", map[string]string{"tenant_id": tenant.ID})
}

func (repository *Postgres) UpdatePlacementOrganization(contextValue context.Context, transaction pgx.Tx, command app.UpdatePlacementOrganization) (app.PlacementOrganization, error) {
	var organization app.PlacementOrganization
	err := transaction.QueryRow(contextValue, `
		UPDATE tenant.placement_organizations
		SET legal_name = COALESCE($2, legal_name), version = version + 1, updated_at = clock_timestamp()
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING id, code, legal_name, status, version, created_at
	`, command.ID, command.LegalName).Scan(&organization.ID, &organization.Code, &organization.LegalName, &organization.Status, &organization.Version, &organization.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.PlacementOrganization{}, apperrors.New(apperrors.CodeNotFound, "placement organization was not found")
	}
	if err != nil {
		return app.PlacementOrganization{}, mapWriteError(err, "placement organization could not be updated")
	}
	return organization, repository.announce(contextValue, transaction, "placement_organization", organization.ID, "", "tenant.placement_organization.updated.v1", map[string]string{"placement_organization_id": organization.ID})
}

func (repository *Postgres) UpdateDepartment(contextValue context.Context, transaction pgx.Tx, command app.UpdateDepartment) (app.Department, error) {
	var department app.Department
	err := transaction.QueryRow(contextValue, `
		UPDATE tenant.departments
		SET code = COALESCE($2, code), name = COALESCE($3, name), version = version + 1, updated_at = clock_timestamp()
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING id, COALESCE(tenant_id::text, ''), COALESCE(placement_organization_id::text, ''), department_type, code, name, status, version, created_at
	`, command.ID, command.Code, command.Name).Scan(&department.ID, &department.TenantID, &department.PlacementOrganizationID, &department.DepartmentType, &department.Code, &department.Name, &department.Status, &department.Version, &department.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Department{}, apperrors.New(apperrors.CodeNotFound, "department was not found")
	}
	if err != nil {
		return app.Department{}, mapWriteError(err, "another department already uses that code")
	}
	return department, repository.announce(contextValue, transaction, "department", department.ID, department.TenantID, "tenant.department.updated.v1", map[string]string{"department_id": department.ID, "tenant_id": department.TenantID})
}

func (repository *Postgres) UpdateBatch(contextValue context.Context, transaction pgx.Tx, command app.UpdateBatch) (app.Batch, error) {
	var batch app.Batch
	err := transaction.QueryRow(contextValue, `
		UPDATE tenant.batches
		SET code = COALESCE($2, code), name = COALESCE($3, name), academic_year = COALESCE($4, academic_year),
		    version = version + 1, updated_at = clock_timestamp()
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING id, tenant_id::text, department_id::text, code, name, academic_year, status, version, created_at
	`, command.ID, command.Code, command.Name, command.AcademicYear).Scan(&batch.ID, &batch.TenantID, &batch.DepartmentID, &batch.Code, &batch.Name, &batch.AcademicYear, &batch.Status, &batch.Version, &batch.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Batch{}, apperrors.New(apperrors.CodeNotFound, "batch was not found")
	}
	if err != nil {
		return app.Batch{}, mapWriteError(err, "that department already has a batch with this code and year")
	}
	return batch, repository.announce(contextValue, transaction, "batch", batch.ID, batch.TenantID, "tenant.batch.updated.v1", map[string]string{"batch_id": batch.ID, "tenant_id": batch.TenantID})
}

func (repository *Postgres) announce(contextValue context.Context, transaction pgx.Tx, aggregateType, aggregateID, tenantID, eventType string, fields map[string]string) error {
	payload, err := json.Marshal(fields)
	if err != nil {
		return fmt.Errorf("marshal %s payload: %w", eventType, err)
	}
	return repository.enqueue(contextValue, transaction, aggregateType, aggregateID, tenantID, eventType, payload)
}
