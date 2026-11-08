//go:build integration

package repo_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// Who sees which students (users.current_context_valid_student): a platform grant sees every college,
// a college-wide grant its own college, a node-scoped context only the students of its nodes, a
// grant whose revision snapshot is missing none, and nobody another college's students.
func TestStudentVisibilityByGrantAndNodes(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := migratedPool(ctx, t)

	tenant, otherTenant := uuid.New(), uuid.New()
	deptA, deptB := uuid.New(), uuid.New()
	batchB := uuid.New()
	studentA, studentB, studentOther := uuid.New(), uuid.New(), uuid.New()
	for _, row := range []struct {
		id, tenant, dept uuid.UUID
		roll             string
	}{{studentA, tenant, deptA, "VIS-A"}, {studentB, tenant, deptB, "VIS-B"}, {studentOther, otherTenant, uuid.New(), "VIS-O"}} {
		_, err := pool.Exec(ctx, `INSERT INTO users.students (id, principal_id, tenant_id, enrollment_number, status) VALUES ($1, $2, $3, $4, 'pending')`, row.id, uuid.New(), row.tenant, row.roll)
		require.NoError(t, err)
		_, err = pool.Exec(ctx, `INSERT INTO users.student_department_memberships (id, student_id, tenant_id, department_id, department_type) VALUES ($1, $2, $3, $4, 'college')`, uuid.New(), row.id, row.tenant, row.dept)
		require.NoError(t, err)
	}
	_, err := pool.Exec(ctx, `INSERT INTO users.student_batch_memberships (id, student_id, tenant_id, batch_id) VALUES ($1, $2, $3, $4)`, uuid.New(), studentB, tenant, batchB)
	require.NoError(t, err)

	actor := func(kind string, tenantID *uuid.UUID, withRevision bool) uuid.UUID {
		id := uuid.New()
		_, err := pool.Exec(ctx, `INSERT INTO authz.actor_tenant_authorizations (actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id)
			VALUES ($1, $2, 1, true, $3, $4)`, id, tenantID, kind, uuid.New())
		require.NoError(t, err)
		if withRevision {
			_, err = pool.Exec(ctx, `INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision) VALUES ($1, 1)`, id)
			require.NoError(t, err)
		}
		return id
	}
	zero := uuid.Nil // platform grants are stored under the nil tenant
	platform := actor("platform", &zero, true)
	college := actor("tenant", &tenant, true)
	stale := actor("tenant", &tenant, false)

	visible := func(who uuid.UUID, contextTenant uuid.UUID, nodes []uuid.UUID) []string {
		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer tx.Rollback(ctx) //nolint:errcheck
		contextID := uuid.New()
		var nodeArg any
		if nodes != nil {
			nodeArg = nodes
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO authz.request_contexts (context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id, authz_revision, action, resource, nodes, issued_at, expires_at)
			VALUES ($1, $2, pg_backend_pid(), txid_current(), $3, $4, 1, 'user.read', 'users.students', $5, clock_timestamp(), clock_timestamp() + interval '4 seconds')`,
			contextID, uuid.New(), who, contextTenant, nodeArg)
		require.NoError(t, err)
		_, err = tx.Exec(ctx, `SELECT set_config('app.authz_context_id', $1, true)`, contextID.String())
		require.NoError(t, err)
		_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_user_app`)
		require.NoError(t, err)
		rows, err := tx.Query(ctx, `SELECT enrollment_number FROM users.students ORDER BY enrollment_number`)
		require.NoError(t, err)
		defer rows.Close()
		var rolls []string
		for rows.Next() {
			var roll string
			require.NoError(t, rows.Scan(&roll))
			rolls = append(rolls, roll)
		}
		require.NoError(t, rows.Err())
		return rolls
	}

	require.Equal(t, []string{"VIS-A", "VIS-B"}, visible(platform, tenant, nil), "a platform administrator sees the college it works in")
	require.Equal(t, []string{"VIS-O"}, visible(platform, otherTenant, nil), "and any other college")
	require.Equal(t, []string{"VIS-A", "VIS-B"}, visible(college, tenant, nil), "a college-wide grant sees its whole college")
	require.Empty(t, visible(college, otherTenant, nil), "but not another college")
	require.Equal(t, []string{"VIS-A"}, visible(college, tenant, []uuid.UUID{deptA}), "a department-scoped context sees its department's students")
	require.Equal(t, []string{"VIS-B"}, visible(college, tenant, []uuid.UUID{batchB}), "a batch-scoped context sees its batch's students")
	require.Equal(t, []string{"VIS-A", "VIS-B"}, visible(college, tenant, []uuid.UUID{deptA, batchB}), "several nodes add up")
	require.Empty(t, visible(college, tenant, []uuid.UUID{uuid.New()}), "a node with no students shows none")
	require.Empty(t, visible(stale, tenant, nil), "a grant without its applied revision snapshot shows none")
}
