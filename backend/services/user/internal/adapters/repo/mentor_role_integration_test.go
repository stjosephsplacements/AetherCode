//go:build integration

package repo_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

func TestMentorMustHoldAnActiveRoleInTheTenant(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := migratedPool(ctx, t)
	tenant, other, actor := uuid.New(), uuid.New(), uuid.New()
	mentor, student, revoked := uuid.New(), uuid.New(), uuid.New()
	exec := func(sql string, args ...any) {
		t.Helper()
		_, err := pool.Exec(ctx, sql, args...)
		require.NoError(t, err, sql)
	}
	exec(`INSERT INTO authz.actor_tenant_authorizations (actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id) VALUES ($1, $2, 1, true, 'tenant', $3)`, actor, tenant, uuid.New())
	exec(`INSERT INTO authz.actor_tenant_authorizations (actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id) VALUES ($1, $2, 1, true, 'tenant', $3)`, actor, other, uuid.New())
	exec(`INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision) VALUES ($1, 1)`, actor)
	exec(`UPDATE authz.authorization_projection_resync_state SET active_resync_id = gen_random_uuid(), completion_event_id = gen_random_uuid(), expected_snapshot_count = 1, expected_manifest_sha256 = sha256('manifest'), completed_at = clock_timestamp(), projection_ready = true`)
	assign := func(principal, tenantID, scopeID uuid.UUID, role, scope, status string) {
		revokedAt := "NULL"
		if status == "revoked" {
			revokedAt = "clock_timestamp()"
		}
		exec(`INSERT INTO users.role_assignments (id, principal_id, role_name, scope_kind, tenant_id, scope_id, status, revoked_at, granted_by_principal_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, `+revokedAt+`, $8)`, uuid.New(), principal, role, scope, tenantID, scopeID, status, actor)
	}
	assign(mentor, tenant, uuid.New(), "mentor", "batch", "active")
	assign(student, tenant, student, "student", "self", "active")
	assign(revoked, tenant, uuid.New(), "mentor", "batch", "revoked")

	holds := func(principal, tenantID uuid.UUID) bool {
		var ok bool
		withContext(ctx, t, pool, actor.String(), tenantID.String(), "users.mentor_batch_assignments", func(tx pgx.Tx) {
			require.NoError(t, tx.QueryRow(ctx, `SELECT users.principal_has_tenant_role($1, $2)`, tenantID, principal).Scan(&ok))
		})
		return ok
	}
	require.True(t, holds(mentor, tenant))
	require.False(t, holds(student, tenant), "a student cannot mentor")
	require.False(t, holds(revoked, tenant), "a revoked role does not count")
	require.False(t, holds(mentor, other), "a role in another college does not count")
}
