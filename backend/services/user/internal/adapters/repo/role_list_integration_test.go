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

func TestGlobalRoleListIncludesCollegeAssignments(t *testing.T) {
	ctx := context.Background()
	pool := migratedPool(ctx, t)
	actor, tenant, other := uuid.NewString(), uuid.NewString(), uuid.NewString()
	_, err := pool.Exec(ctx, `INSERT INTO authz.actor_tenant_authorizations (actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id) VALUES ($1,$2,1,true,'platform',gen_random_uuid())`, actor, tenant)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO users.role_assignments (id,principal_id,role_name,scope_kind,tenant_id,scope_id,granted_by_principal_id) VALUES (gen_random_uuid(),gen_random_uuid(),'college_admin','college',$1,$1,$3), (gen_random_uuid(),gen_random_uuid(),'college_admin','college',$2,$2,$3)`, tenant, other, actor)
	require.NoError(t, err)
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx) //nolint:errcheck
	contextID := uuid.NewString()
	_, err = tx.Exec(ctx, `INSERT INTO authz.request_contexts (context_id,capability_id,backend_pid,transaction_id,actor_id,tenant_id,authz_revision,action,resource,issued_at,expires_at) VALUES ($1,gen_random_uuid(),pg_backend_pid(),txid_current(),$2,NULL,1,'user.read','users.role_assignments',clock_timestamp(),clock_timestamp()+interval '4 seconds')`, contextID, actor)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `SELECT set_config('app.authz_context_id',$1,true)`, contextID)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_user_app`)
	require.NoError(t, err)
	rows, err := repo.NewPostgres(pool).ListRoleAssignments(ctx, tx, app.ListRoleAssignments{Limit: 10})
	require.NoError(t, err)
	require.Len(t, rows, 2)
	require.NoError(t, tx.Rollback(ctx))

	collegeActor := uuid.NewString()
	_, err = pool.Exec(ctx, `INSERT INTO authz.actor_tenant_authorizations (actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id) VALUES ($1,$2,1,true,'tenant',gen_random_uuid())`, collegeActor, tenant)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision) VALUES ($1,1)`, collegeActor)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `UPDATE authz.authorization_projection_resync_state SET active_resync_id = gen_random_uuid(), completion_event_id = gen_random_uuid(), expected_snapshot_count = 1, expected_manifest_sha256 = sha256('manifest'), completed_at = clock_timestamp(), projection_ready = true`)
	require.NoError(t, err)
	withContext(ctx, t, pool, collegeActor, tenant, "users.role_assignments", func(tx pgx.Tx) {
		rows, err := repo.NewPostgres(pool).ListRoleAssignments(ctx, tx, app.ListRoleAssignments{Limit: 10})
		require.NoError(t, err)
		require.Len(t, rows, 1)
		require.Equal(t, tenant, rows[0].TenantID)
	})
}
