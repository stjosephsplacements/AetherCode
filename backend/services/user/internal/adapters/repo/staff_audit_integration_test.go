//go:build integration

package repo_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/aethercode/aethercode/services/user/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/user/internal/app"
)

// TestStaffAudit covers ADR-0043's database side: the read-only authorization
// role can append decisions and nothing else, and a college administrator's
// context lists only that college's entries, newest first.
func TestStaffAudit(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := migratedPool(ctx, t)
	tenant, otherTenant, actor := uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO authz.actor_tenant_authorizations (actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id)
		  VALUES ($1, $2, 1, true, 'tenant', gen_random_uuid())`, []any{actor, tenant}},
		{`INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision) VALUES ($1, 1)`, []any{actor}},
		{`UPDATE authz.authorization_projection_resync_state
		  SET active_resync_id = gen_random_uuid(), completion_event_id = gen_random_uuid(), expected_snapshot_count = 1,
		      expected_manifest_sha256 = sha256('manifest'), completed_at = clock_timestamp(), projection_ready = true`, nil},
	} {
		_, err := pool.Exec(ctx, statement.sql, statement.args...)
		require.NoError(t, err, statement.sql)
	}

	// The authorization role appends through the function only.
	reader, err := pool.Begin(ctx)
	require.NoError(t, err)
	_, err = reader.Exec(ctx, `SET LOCAL ROLE aether_user_authz_reader`)
	require.NoError(t, err)
	for _, entry := range []struct {
		tenant, resource string
		allowed          bool
	}{{tenant, "attempt_events", true}, {tenant, "question_exports", false}, {otherTenant, "exams", true}} {
		_, err = reader.Exec(ctx, `SELECT users.record_staff_action($1, $2, 'submission', $3, 'resource-1', $4)`, actor, entry.tenant, entry.resource, entry.allowed)
		require.NoError(t, err)
	}
	_, err = reader.Exec(ctx, `DELETE FROM users.staff_audit`)
	require.Error(t, err, "the authorization role cannot change the log")
	// The failed DELETE aborted the transaction; the appended rows go with it.
	require.NoError(t, reader.Rollback(ctx))

	repository := repo.NewPostgres(pool)
	require.NoError(t, repository.RecordStaffAction(ctx, app.StaffAction{PrincipalID: actor, TenantID: tenant, TargetService: "submission",
		ResourceType: "attempt_events", ResourceID: "resource-2", Allowed: true}))
	require.NoError(t, repository.RecordStaffAction(ctx, app.StaffAction{PrincipalID: actor, TenantID: otherTenant, TargetService: "assessment",
		ResourceType: "exams", ResourceID: "resource-3", Allowed: true}))
	require.NoError(t, repository.RecordStaffAction(ctx, app.StaffAction{PrincipalID: actor, TargetService: "question-bank",
		ResourceType: "questions", ResourceID: "resource-4", Allowed: true}))

	list := func(resource string) ([]map[string]any, error) {
		var entries []map[string]any
		transaction, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer transaction.Rollback(ctx) //nolint:errcheck
		contextID := uuid.NewString()
		_, err = transaction.Exec(ctx, `
			INSERT INTO authz.request_contexts (context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id,
			    authz_revision, action, resource, issued_at, expires_at)
			VALUES ($1, gen_random_uuid(), pg_backend_pid(), txid_current(), $2, $3, 1, 'user.read', $4,
			    clock_timestamp(), clock_timestamp() + interval '4 seconds')`, contextID, actor, tenant, resource)
		require.NoError(t, err)
		_, err = transaction.Exec(ctx, `SELECT set_config('app.authz_context_id', $1, true)`, contextID)
		require.NoError(t, err)
		_, err = transaction.Exec(ctx, `SET LOCAL ROLE aether_user_app`)
		require.NoError(t, err)
		raw, err := repository.ListStaffAudit(ctx, transaction, tenant, nil, 50)
		if err != nil {
			return nil, err
		}
		return entries, json.Unmarshal(raw, &entries)
	}
	_, err = list("users.students")
	require.Error(t, err, "another resource's capability cannot read the log")
	entries, err := list("users.staff_audit")
	require.NoError(t, err)
	require.Len(t, entries, 1, "only this college's entries recorded through the repository")
	require.Equal(t, "resource-2", entries[0]["resource_id"])
	require.Equal(t, true, entries[0]["allowed"])
}
