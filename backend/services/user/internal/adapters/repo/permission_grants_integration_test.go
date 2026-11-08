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

func TestCollegePermissionEditorSavesStaffGrants(t *testing.T) {
	ctx := context.Background()
	pool := migratedPool(ctx, t)
	tenant, actor, staff := uuid.NewString(), uuid.NewString(), uuid.NewString()
	_, err := pool.Exec(ctx, `INSERT INTO authz.actor_tenant_authorizations (actor_id,tenant_id,authz_revision,is_authorized,grant_kind,grant_source_id) VALUES ($1,$2,1,true,'tenant',gen_random_uuid())`, actor, tenant)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO authz.principal_authorization_revisions (actor_id,authz_revision) VALUES ($1,1)`, actor)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `UPDATE authz.authorization_projection_resync_state SET active_resync_id=gen_random_uuid(), completion_event_id=gen_random_uuid(), expected_snapshot_count=1, expected_manifest_sha256=sha256('manifest'), completed_at=clock_timestamp(), projection_ready=true`)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO users.role_assignments (id,principal_id,role_name,scope_kind,tenant_id,scope_id,granted_by_principal_id) VALUES (gen_random_uuid(),$1,'college_admin','college',$2,$2,$3)`, staff, tenant, actor)
	require.NoError(t, err)
	withContext(ctx, t, pool, actor, tenant, "users.permission_grants", func(tx pgx.Tx) {
		grants, err := repo.NewPostgres(pool).ReplacePermissionGrants(ctx, tx, app.SetPermissionGrants{PrincipalID: staff, TenantID: tenant, GrantedBy: actor, Permissions: []string{"user.students.read"}})
		require.NoError(t, err)
		require.Equal(t, []string{"user.students.read"}, grants)
		var visible bool
		err = tx.QueryRow(ctx, `SELECT users.permission_target_is_staff($1, $2)`, staff, uuid.NewString()).Scan(&visible)
		require.NoError(t, err)
		require.False(t, visible, "a college context cannot inspect another college")
		grants, err = repo.NewPostgres(pool).ReplacePermissionGrants(ctx, tx, app.SetPermissionGrants{PrincipalID: staff, TenantID: tenant, GrantedBy: actor, Permissions: []string{}})
		require.NoError(t, err)
		require.Empty(t, grants)
	})
	withContext(ctx, t, pool, actor, tenant, "users.students", func(tx pgx.Tx) {
		var visible bool
		err := tx.QueryRow(ctx, `SELECT users.permission_target_is_staff($1, $2)`, staff, tenant).Scan(&visible)
		require.NoError(t, err)
		require.False(t, visible, "an unrelated capability cannot inspect staff status")
	})
}
