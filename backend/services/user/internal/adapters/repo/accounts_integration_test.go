//go:build integration

package repo_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/aethercode/aethercode/services/user/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/user/internal/app"
)

// TestAccountManagementFunctions exercises migration 000024 as the
// application role under seeded users.accounts contexts.
func TestAccountManagementFunctions(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := migratedPool(ctx, t)
	repository := repo.NewPostgres(pool)

	tenant, otherTenant := uuid.NewString(), uuid.NewString()
	collegeDepartment, otherDepartment, placementDepartment := uuid.NewString(), uuid.NewString(), uuid.NewString()
	batch, otherBatch := uuid.NewString(), uuid.NewString()
	actor := uuid.NewString()
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO users.tenant_department_projections
		      (department_id, department_type, tenant_id, placement_organization_id, status, source_event_id, source_occurred_at)
		  VALUES ($1, 'college', $2, NULL, 'active', gen_random_uuid(), now()), ($3, 'college', $2, NULL, 'active', gen_random_uuid(), now()),
		         ($4, 'placement', NULL, gen_random_uuid(), 'active', gen_random_uuid(), now())`, []any{collegeDepartment, tenant, otherDepartment, placementDepartment}},
		{`INSERT INTO users.tenant_batch_projections (batch_id, tenant_id, department_id, status, source_event_id, source_occurred_at)
		  VALUES ($1, $2, $3, 'active', gen_random_uuid(), now()), ($4, $2, $5, 'active', gen_random_uuid(), now())`,
			[]any{batch, tenant, collegeDepartment, otherBatch, otherDepartment}},
		{`INSERT INTO authz.actor_tenant_authorizations (actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id)
		  VALUES ($1, $2, 1, true, 'tenant', gen_random_uuid())`, []any{actor, tenant}},
		{`INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision) VALUES ($1, 1)`, []any{actor}},
		// Grants are honoured only after a completed authorization resync.
		{`UPDATE authz.authorization_projection_resync_state
		  SET active_resync_id = gen_random_uuid(), completion_event_id = gen_random_uuid(), expected_snapshot_count = 1,
		      expected_manifest_sha256 = sha256('manifest'), completed_at = clock_timestamp(), projection_ready = true`, nil},
	} {
		_, err := pool.Exec(ctx, statement.sql, statement.args...)
		require.NoError(t, err, statement.sql)
	}

	command := app.StudentImport{TenantID: tenant, BatchID: batch, CollegeDepartmentID: collegeDepartment, PlacementDepartmentID: placementDepartment}
	credentials := []app.IssuedCredential{{PrincipalID: uuid.NewString()}, {PrincipalID: uuid.NewString()}}
	numbers := []string{"22CS001", "22CS002"}

	var students []app.Student
	withContext(ctx, t, pool, actor, tenant, "users.accounts", func(transaction pgx.Tx) {
		existing, err := repository.ExistingEnrollmentNumbers(ctx, transaction, command, numbers)
		require.NoError(t, err)
		require.Empty(t, existing)
		students, err = repository.ImportStudents(ctx, transaction, command, actor, credentials, numbers)
		require.NoError(t, err)
	})
	require.Len(t, students, 2)
	for index, student := range students {
		require.Equal(t, credentials[index].PrincipalID, student.PrincipalID, "results keep the input order")
		require.Equal(t, numbers[index], student.EnrollmentNumber)
		require.Equal(t, 2, student.Version, "enrolled students are active")
	}
	var activeInBatch, studentRoles, events int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM users.current_student_batch_affiliations
		WHERE batch_id = $1 AND lifecycle_state = 'active' AND version = 2`, batch).Scan(&activeInBatch))
	require.Equal(t, 2, activeInBatch)
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM users.role_assignments WHERE role_name = 'student' AND tenant_id = $1`, tenant).Scan(&studentRoles))
	require.Equal(t, 2, studentRoles)
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM app.outbox_events WHERE event_type IN
		('user.student.enrolled.v1', 'user.student_batch_affiliation.snapshot.v1')`).Scan(&events))
	require.Equal(t, 4, events)

	withContext(ctx, t, pool, actor, tenant, "users.accounts", func(transaction pgx.Tx) {
		existing, err := repository.ExistingEnrollmentNumbers(ctx, transaction, command, []string{"22CS002", "22CS003"})
		require.NoError(t, err)
		require.Equal(t, []string{"22CS002"}, existing, "a re-import skips roll numbers the college has")
	})
	withContext(ctx, t, pool, actor, tenant, "users.accounts", func(transaction pgx.Tx) {
		mismatched := command
		mismatched.BatchID = otherBatch
		_, err := repository.ExistingEnrollmentNumbers(ctx, transaction, mismatched, numbers)
		require.ErrorContains(t, err, "invalid", "a batch from another department is rejected")
	})
	withContext(ctx, t, pool, actor, tenant, "users.students", func(transaction pgx.Tx) {
		_, err := repository.ImportStudents(ctx, transaction, command, actor, []app.IssuedCredential{{PrincipalID: uuid.NewString()}}, []string{"22CS009"})
		require.ErrorContains(t, err, "authorization denied", "a students capability cannot import accounts")
	})

	// Staff: a college administrator, a faculty member, and a principal that
	// also holds a role in another college, which this college cannot manage.
	admin, facultyMember, shared := uuid.NewString(), uuid.NewString(), uuid.NewString()
	withContext(ctx, t, pool, actor, tenant, "users.accounts", func(transaction pgx.Tx) {
		assignment, err := repository.GrantStaffRole(ctx, transaction, app.StaffAccount{TenantID: tenant, Role: "college_admin"}, admin, actor)
		require.NoError(t, err)
		require.Equal(t, "college", assignment.ScopeKind)
		require.Equal(t, tenant, assignment.ScopeID)
		assignment, err = repository.GrantStaffRole(ctx, transaction, app.StaffAccount{TenantID: tenant, Role: "department_user", DepartmentID: collegeDepartment}, facultyMember, actor)
		require.NoError(t, err)
		require.Equal(t, collegeDepartment, assignment.ScopeID)
	})
	withContext(ctx, t, pool, actor, tenant, "users.accounts", func(transaction pgx.Tx) {
		_, err := repository.GrantStaffRole(ctx, transaction, app.StaffAccount{TenantID: tenant, Role: "department_user", DepartmentID: placementDepartment}, shared, actor)
		require.Error(t, err, "faculty must belong to one of this college's departments")
	})
	_, err := pool.Exec(ctx, `INSERT INTO users.role_assignments (id, principal_id, role_name, scope_kind, tenant_id, scope_id, granted_by_principal_id)
		VALUES (gen_random_uuid(), $1, 'college_admin', 'college', $2, $2, $3), (gen_random_uuid(), $1, 'department_user', 'department', $4, $5, $3)`,
		shared, otherTenant, actor, tenant, collegeDepartment)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO users.role_assignments (id, principal_id, role_name, scope_kind, granted_by_principal_id)
		VALUES (gen_random_uuid(), $1, 'super_admin', 'platform', $1)`, actor)
	require.NoError(t, err)

	withContext(ctx, t, pool, actor, tenant, "users.accounts", func(transaction pgx.Tx) {
		manageable, err := repository.TenantAccountPrincipals(ctx, transaction, tenant,
			[]string{credentials[0].PrincipalID, admin, facultyMember, shared, actor, uuid.NewString()})
		require.NoError(t, err)
		require.ElementsMatch(t, []string{credentials[0].PrincipalID, admin, facultyMember}, manageable,
			"only students and staff held by this college alone are manageable")
		inBatch, err := repository.BatchAccountPrincipals(ctx, transaction, tenant, batch)
		require.NoError(t, err)
		require.Equal(t, []string{credentials[0].PrincipalID, credentials[1].PrincipalID}, inBatch)
	})
	// ADR-0020: staff tenant grants say they author the global bank; a
	// student's tenant grant does not.
	for principal, wantAuthoring := range map[string]bool{facultyMember: true, admin: true, credentials[0].PrincipalID: false} {
		var grants string
		require.NoError(t, pool.QueryRow(ctx, `SELECT users.effective_authz_grants($1)::text`, principal).Scan(&grants))
		require.Equal(t, wantAuthoring, strings.Contains(grants, `"authoring": true`), grants)
	}

	withContext(ctx, t, pool, actor, otherTenant, "users.accounts", func(transaction pgx.Tx) {
		_, err := repository.TenantAccountPrincipals(ctx, transaction, tenant, []string{admin})
		require.ErrorContains(t, err, "authorization denied", "a context for another college cannot list this college's accounts")
	})
}

// withContext runs work as aether_user_app inside a transaction carrying a
// seeded users.accounts-style context (the HMAC gate is bypassed, which is
// valid only in this disposable container).
func withContext(ctx context.Context, t *testing.T, pool *pgxpool.Pool, actor, tenant, resource string, work func(pgx.Tx)) {
	t.Helper()
	transaction, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer transaction.Rollback(ctx) //nolint:errcheck
	contextID := uuid.NewString()
	_, err = transaction.Exec(ctx, `
		INSERT INTO authz.request_contexts (context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id,
		    authz_revision, action, resource, issued_at, expires_at)
		VALUES ($1, gen_random_uuid(), pg_backend_pid(), txid_current(), $2, $3, 1, 'user.write', $4,
		    clock_timestamp(), clock_timestamp() + interval '4 seconds')`, contextID, actor, tenant, resource)
	require.NoError(t, err)
	_, err = transaction.Exec(ctx, `SELECT set_config('app.authz_context_id', $1, true)`, contextID)
	require.NoError(t, err)
	_, err = transaction.Exec(ctx, `SET LOCAL ROLE aether_user_app`)
	require.NoError(t, err)
	work(transaction)
	// A transaction that hit an expected error is aborted and rolls back.
	if err := transaction.Commit(ctx); err != nil && !errors.Is(err, pgx.ErrTxCommitRollback) {
		require.NoError(t, err)
	}
}
