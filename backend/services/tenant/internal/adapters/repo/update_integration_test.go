//go:build integration

package repo_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/stjosephsplacements/AetherCode/services/tenant/internal/adapters/repo"
	"github.com/stjosephsplacements/AetherCode/services/tenant/internal/app"
)

func ptr(value string) *string { return &value }

// TestUpdatingCollegesDepartmentsAndBatches checks that an edit changes only the
// fields given, bumps the version, and cannot take a code another record holds.
func TestUpdatingCollegesDepartmentsAndBatches(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := migratedTenantPool(ctx, t)
	tenant, actor := uuid.New(), uuid.New()
	department, other, batch := uuid.New(), uuid.New(), uuid.New()
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO tenant.tenants (id, slug, legal_name, display_name) VALUES ($1, 'update-test', 'Update Test Legal', 'Update Test')`, []any{tenant}},
		{`INSERT INTO tenant.departments (id, tenant_id, department_type, code, name) VALUES ($1, $2, 'college', 'CSE', 'Computer Science')`, []any{department, tenant}},
		{`INSERT INTO tenant.departments (id, tenant_id, department_type, code, name) VALUES ($1, $2, 'college', 'ECE', 'Electronics')`, []any{other, tenant}},
		{`INSERT INTO tenant.batches (id, tenant_id, department_id, code, name, academic_year) VALUES ($1, $2, $3, 'B1', 'Batch one', '2026-2030')`, []any{batch, tenant, department}},
		{`INSERT INTO authz.actor_tenant_authorizations (actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id) VALUES ($1, $2, 1, true, 'tenant', $2)`, []any{actor, tenant}},
		{`INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision) VALUES ($1, 1)`, []any{actor}},
		{`UPDATE authz.authorization_projection_resync_state SET projection_ready = true, active_resync_id = gen_random_uuid(), completion_event_id = gen_random_uuid(),
		  expected_snapshot_count = 0, expected_manifest_sha256 = decode(repeat('00', 32), 'hex') WHERE singleton = true`, nil},
	} {
		_, err := pool.Exec(ctx, statement.sql, statement.args...)
		require.NoError(t, err, statement.sql)
	}
	store, err := repo.NewPostgres(pool)
	require.NoError(t, err)

	asApp := func(resource string, fn func(pgx.Tx) error) error {
		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer tx.Rollback(ctx) //nolint:errcheck
		contextID := uuid.New()
		_, err = tx.Exec(ctx, `INSERT INTO authz.request_contexts (context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id, authz_revision, action, resource, issued_at, expires_at)
			VALUES ($1, $2, pg_backend_pid(), txid_current(), $3, $4, 1, 'tenant.write', $5, clock_timestamp(), clock_timestamp() + interval '4 seconds')`,
			contextID, uuid.New(), actor, tenant, resource)
		require.NoError(t, err)
		_, err = tx.Exec(ctx, `SELECT set_config('app.authz_context_id', $1, true)`, contextID.String())
		require.NoError(t, err)
		_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_tenant_app`)
		require.NoError(t, err)
		if err := fn(tx); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}

	var college app.Tenant
	require.NoError(t, asApp("tenant.tenants", func(tx pgx.Tx) (err error) {
		college, err = store.UpdateTenant(ctx, tx, app.UpdateTenant{ID: tenant.String(), DisplayName: ptr("Renamed College")})
		return err
	}))
	require.Equal(t, "Renamed College", college.DisplayName)
	require.Equal(t, "Update Test Legal", college.LegalName, "a field left out stays as it was")
	require.Equal(t, 2, college.Version)

	var renamed app.Department
	require.NoError(t, asApp("tenant.departments", func(tx pgx.Tx) (err error) {
		renamed, err = store.UpdateDepartment(ctx, tx, app.UpdateDepartment{ID: department.String(), Name: ptr("Computing")})
		return err
	}))
	require.Equal(t, "Computing", renamed.Name)
	require.Equal(t, "CSE", renamed.Code)

	err = asApp("tenant.departments", func(tx pgx.Tx) error {
		_, err := store.UpdateDepartment(ctx, tx, app.UpdateDepartment{ID: department.String(), Code: ptr("ece")})
		return err
	})
	require.ErrorContains(t, err, "already uses that code", "codes are unique within a college, whatever the case")

	var moved app.Batch
	require.NoError(t, asApp("tenant.batches", func(tx pgx.Tx) (err error) {
		moved, err = store.UpdateBatch(ctx, tx, app.UpdateBatch{ID: batch.String(), Name: ptr("Batch of 2030"), AcademicYear: ptr("2027-2031")})
		return err
	}))
	require.Equal(t, "Batch of 2030", moved.Name)
	require.Equal(t, "2027-2031", moved.AcademicYear)
	require.Equal(t, "B1", moved.Code)

	err = asApp("tenant.batches", func(tx pgx.Tx) error {
		_, err := store.UpdateBatch(ctx, tx, app.UpdateBatch{ID: uuid.NewString(), Name: ptr("Nobody")})
		return err
	})
	require.ErrorContains(t, err, "not found")
}
