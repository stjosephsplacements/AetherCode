//go:build integration

package repo_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stjosephsplacements/AetherCode/services/user/internal/adapters/repo"
	"github.com/stjosephsplacements/AetherCode/services/user/internal/app"
	"github.com/stretchr/testify/require"
)

// A soft-deleted assignment must not reach the authorization snapshot: it carries the role's permission
// bits, so returning it would let a deleted grant keep authorizing requests.
func TestSnapshotExcludesSoftDeletedAssignments(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := migratedPool(ctx, t)
	tenant, principal, actor := uuid.New(), uuid.New(), uuid.New()
	exec := func(sql string, args ...any) {
		t.Helper()
		_, err := pool.Exec(ctx, sql, args...)
		require.NoError(t, err, sql)
	}
	// The tenant's mentor role, with one permission bit set: the live assignment must keep it.
	exec(`INSERT INTO users.roles (guild_kind, tenant_id, tier, name, position, permissions, system_key)
		VALUES ('college', $1, 1, 'Mentor', 1, (repeat('0', 255) || '1')::bit(256), 'mentor')`, tenant)
	active, deleted := uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{active, deleted} {
		exec(`INSERT INTO users.role_assignments (id, principal_id, role_name, scope_kind, tenant_id, scope_id, status, granted_by_principal_id)
			VALUES ($1, $2, 'mentor', 'batch', $3, $4, 'active', $5)`, id, principal, tenant, uuid.New(), actor)
	}
	exec(`UPDATE users.role_assignments SET deleted_at = clock_timestamp(), deleted_by = $2, deletion_reason = 'test' WHERE id = $1`, deleted, actor)

	snapshot, err := repo.NewPostgres(pool).Snapshot(ctx, app.SnapshotQuery{PrincipalID: principal.String(), TenantID: tenant.String(), ResourceType: "students", ResourceID: uuid.NewString()})
	require.NoError(t, err)
	require.Len(t, snapshot.Assignments, 1, "only the live assignment is returned")
	require.True(t, snapshot.Assignments[0].HasPerms, "the live assignment keeps its role")
	require.Equal(t, 1, snapshot.Assignments[0].Perms.Count(), "and that role's permission bits")
}
