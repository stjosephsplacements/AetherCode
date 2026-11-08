//go:build integration

package repo_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stjosephsplacements/AetherCode/services/user/internal/adapters/repo"
	"github.com/stjosephsplacements/AetherCode/services/user/internal/app"
	"github.com/stretchr/testify/require"
)

// asStaff runs work in a transaction as the application role, scoped by a seeded authorization
// context to one tenant and one action on users.students (the capability the roster route uses).
func asStaff(ctx context.Context, t *testing.T, pool interface {
	Begin(context.Context) (pgx.Tx, error)
}, actor, tenant uuid.UUID, work func(pgx.Tx)) {
	t.Helper()
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx) //nolint:errcheck
	contextID := uuid.New()
	_, err = tx.Exec(ctx, `
		INSERT INTO authz.request_contexts
		    (context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id, authz_revision, action, resource, issued_at, expires_at)
		VALUES ($1, $2, pg_backend_pid(), txid_current(), $3, $4, 1, 'user.read', 'users.students', clock_timestamp(), clock_timestamp() + interval '4 seconds')`,
		contextID, uuid.New(), actor, tenant)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `SELECT set_config('app.authz_context_id', $1, true)`, contextID.String())
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_user_app`)
	require.NoError(t, err)
	work(tx)
}

func TestListStudentRosterJoinsBatchDepartmentsNameAndMentors(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := migratedPool(ctx, t)

	tenant, other := uuid.New(), uuid.New()
	actor, batch, otherBatch := uuid.New(), uuid.New(), uuid.New()
	collegeDept, placementDept, mentor := uuid.New(), uuid.New(), uuid.New()

	exec := func(sql string, args ...any) {
		t.Helper()
		_, err := pool.Exec(ctx, sql, args...)
		require.NoError(t, err, sql)
	}
	exec(`INSERT INTO authz.actor_tenant_authorizations (actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id) VALUES ($1, $2, 1, true, 'tenant', $3)`, actor, tenant, uuid.New())
	exec(`INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision) VALUES ($1, 1)`, actor)

	type seeded struct{ id, principal uuid.UUID }
	student := func(tenantID uuid.UUID, roll, given, family string, batchID *uuid.UUID, withDepartments bool) seeded {
		s := seeded{uuid.New(), uuid.New()}
		exec(`INSERT INTO users.students (id, principal_id, tenant_id, enrollment_number, status) VALUES ($1, $2, $3, $4, 'pending')`, s.id, s.principal, tenantID, roll)
		if given != "" {
			exec(`INSERT INTO users.profiles (principal_id, given_name, family_name) VALUES ($1, $2, $3)`, s.principal, given, family)
		}
		if batchID != nil {
			membership := uuid.New()
			exec(`INSERT INTO users.student_batch_memberships (id, student_id, tenant_id, batch_id) VALUES ($1, $2, $3, $4)`, membership, s.id, tenantID, *batchID)
			exec(`UPDATE users.current_student_batch_affiliations SET batch_id = $2, batch_membership_id = $3, lifecycle_state = 'active' WHERE student_id = $1`, s.id, *batchID, membership)
		}
		if withDepartments {
			exec(`INSERT INTO users.student_department_memberships (id, student_id, tenant_id, department_id, department_type) VALUES ($1, $2, $3, $4, 'college')`, uuid.New(), s.id, tenantID, collegeDept)
			exec(`INSERT INTO users.student_department_memberships (id, student_id, tenant_id, department_id, department_type) VALUES ($1, $2, $3, $4, 'placement')`, uuid.New(), s.id, tenantID, placementDept)
		}
		return s
	}
	asha := student(tenant, "21CS001", "Asha", "Raman", &batch, true)
	student(tenant, "21CS002", "Vikram", "Iyer", &batch, false)
	student(tenant, "21EC010", "", "", nil, false)
	student(other, "99XX001", "Elsewhere", "Student", &otherBatch, false)
	exec(`INSERT INTO users.mentor_batch_assignments (id, mentor_principal_id, tenant_id, batch_id, assigned_by_principal_id) VALUES ($1, $2, $3, $4, $5)`, uuid.New(), mentor, tenant, batch, actor)

	store := repo.NewPostgres(pool)
	list := func(command app.ListRoster) (students []app.RosterStudent, total int) {
		command.TenantID = tenant.String()
		if command.Limit == 0 {
			command.Limit = 50
		}
		if command.Sort == "" {
			command.Sort = "enrollment_number"
		}
		asStaff(ctx, t, pool, actor, tenant, func(tx pgx.Tx) {
			var err error
			students, total, err = store.ListStudentRoster(ctx, tx, command)
			require.NoError(t, err)
		})
		return students, total
	}

	students, total := list(app.ListRoster{})
	require.Equal(t, 3, total, "only this college's students count")
	require.Len(t, students, 3)
	require.Equal(t, "21CS001", students[0].EnrollmentNumber)
	require.Equal(t, asha.id.String(), students[0].ID)
	require.Equal(t, batch.String(), students[0].BatchID)
	require.Equal(t, collegeDept.String(), students[0].CollegeDepartmentID)
	require.Equal(t, placementDept.String(), students[0].PlacementDepartmentID)
	require.Equal(t, "Asha Raman", students[0].ProfileName)
	require.Equal(t, []string{mentor.String()}, students[0].MentorPrincipalIDs, "the batch's active mentor")
	require.Empty(t, students[2].BatchID, "a student with no batch has none")
	require.Empty(t, students[2].MentorPrincipalIDs)

	byName, _ := list(app.ListRoster{Sort: "name"})
	require.Equal(t, []string{"21EC010", "21CS001", "21CS002"}, []string{byName[0].EnrollmentNumber, byName[1].EnrollmentNumber, byName[2].EnrollmentNumber}, "unnamed first, then Asha, then Vikram")

	found, count := list(app.ListRoster{Query: "vik"})
	require.Equal(t, 1, count)
	require.Equal(t, "21CS002", found[0].EnrollmentNumber)
	found, _ = list(app.ListRoster{Query: "21cs"})
	require.Len(t, found, 2)
	found, _ = list(app.ListRoster{Query: "%"})
	require.Empty(t, found, "a percent sign is searched for, not treated as a wildcard")

	found, _ = list(app.ListRoster{BatchID: batch.String()})
	require.Len(t, found, 2)
	found, _ = list(app.ListRoster{PlacementDepartmentID: placementDept.String()})
	require.Len(t, found, 1)

	first, _ := list(app.ListRoster{Limit: 1})
	require.Len(t, first, 1)
	second, _ := list(app.ListRoster{Limit: 1, CursorSort: first[0].EnrollmentNumber, CursorID: first[0].ID})
	require.Len(t, second, 1)
	require.Equal(t, "21CS002", second[0].EnrollmentNumber, "the cursor continues after the last row")
	desc, _ := list(app.ListRoster{Descending: true})
	require.Equal(t, "21EC010", desc[0].EnrollmentNumber)

	// An actor authorised for another college sees none of this college's students, even
	// when naming this college in the request.
	stranger := uuid.New()
	exec(`INSERT INTO authz.actor_tenant_authorizations (actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id) VALUES ($1, $2, 1, true, 'tenant', $3)`, stranger, other, uuid.New())
	exec(`INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision) VALUES ($1, 1)`, stranger)
	asStaff(ctx, t, pool, stranger, other, func(tx pgx.Tx) {
		students, total, err := store.ListStudentRoster(ctx, tx, app.ListRoster{TenantID: tenant.String(), Limit: 50, Sort: "enrollment_number"})
		require.NoError(t, err)
		require.Empty(t, students)
		require.Zero(t, total)
	})
}
