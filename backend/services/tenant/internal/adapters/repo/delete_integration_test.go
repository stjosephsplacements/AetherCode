//go:build integration

package repo_test

import (
	"context"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/aethercode/aethercode/libs/pkg/testutil/integration"
	"github.com/aethercode/aethercode/services/tenant/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/tenant/internal/app"
)

// migratedTenantPool starts PostgreSQL with the tenant roles and every migration.
func migratedTenantPool(ctx context.Context, t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := integration.StartPostgres(ctx, t)
	for _, stmt := range []string{
		`CREATE ROLE aether_tenant_owner       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_tenant_migrator    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_tenant_app         NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_tenant_authz_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_tenant_projection_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`GRANT aether_tenant_owner TO aether_tenant_migrator`,
		`ALTER DATABASE testdb OWNER TO aether_tenant_owner`,
		`ALTER SCHEMA public OWNER TO aether_tenant_owner`,
		`CREATE TABLE public.schema_migrations (version bigint NOT NULL PRIMARY KEY, dirty boolean NOT NULL)`,
		`ALTER TABLE public.schema_migrations OWNER TO aether_tenant_owner`,
	} {
		_, err := pool.Exec(ctx, stmt)
		require.NoError(t, err, stmt[:min(len(stmt), 60)])
	}
	_, file, _, _ := runtime.Caller(0)
	directory, err := filepath.Abs(filepath.Join(filepath.Dir(file), "../../..", "migrations"))
	require.NoError(t, err)
	integration.ApplyMigrations(ctx, t, pool, directory)
	return pool
}

// TestDeletingDepartmentsAndBatches covers ADR-0053 in the tenant service: a batch
// deletes, and a department deletes only once it has no live batch left.
func TestDeletingDepartmentsAndBatches(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := migratedTenantPool(ctx, t)
	tenant, actor := uuid.New(), uuid.New()
	department, batch := uuid.New(), uuid.New()
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO tenant.tenants (id, slug, legal_name, display_name) VALUES ($1, 'delete-test', 'Delete Test Legal', 'Delete Test')`, []any{tenant}},
		{`INSERT INTO tenant.departments (id, tenant_id, department_type, code, name) VALUES ($1, $2, 'college', 'CSE', 'Computer Science')`, []any{department, tenant}},
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
	command := func(id uuid.UUID) app.DeleteEntity {
		return app.DeleteEntity{ID: id.String(), ActorID: actor.String(), Reason: "created by mistake"}
	}

	err = asApp("tenant.departments", func(tx pgx.Tx) error { return store.SoftDeleteDepartment(ctx, tx, command(department)) })
	require.ErrorContains(t, err, "batch", "a department with a live batch is kept")

	require.NoError(t, asApp("tenant.batches", func(tx pgx.Tx) error { return store.SoftDeleteBatch(ctx, tx, command(batch)) }))
	require.NoError(t, asApp("tenant.departments", func(tx pgx.Tx) error { return store.SoftDeleteDepartment(ctx, tx, command(department)) }))

	var batchGone, departmentGone bool
	require.NoError(t, pool.QueryRow(ctx, `SELECT deleted_at IS NOT NULL FROM tenant.batches WHERE id = $1`, batch).Scan(&batchGone))
	require.NoError(t, pool.QueryRow(ctx, `SELECT deleted_at IS NOT NULL FROM tenant.departments WHERE id = $1`, department).Scan(&departmentGone))
	require.True(t, batchGone)
	require.True(t, departmentGone)
}
