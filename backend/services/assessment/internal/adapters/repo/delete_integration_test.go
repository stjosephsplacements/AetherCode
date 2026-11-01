//go:build integration

package repo_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/aethercode/aethercode/services/assessment/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/assessment/internal/app"
)

// TestDeletingExams covers ADR-0053: an exam that was never published can be
// deleted by a signed write context (and its versions go with it), and one that
// was published cannot, however it is asked, because deleting it would cascade
// to the students assigned to it.
func TestDeletingExams(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := migratedPool(ctx, t)
	tenant, actor := uuid.New(), uuid.New()
	policyID, policyVersionID := uuid.New(), uuid.New()
	key := "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90"

	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO assessment.proctor_policies (id, tenant_id, name, created_by) VALUES ($1, $2, 'p', $3)`, []any{policyID, tenant, actor}},
		{`INSERT INTO assessment.proctor_policy_versions (id, tenant_id, proctor_policy_id, version_number, policy, policy_checksum, status, published_at, created_by)
		  VALUES ($1, $2, $3, 1, '{}', $4, 'published', now(), $5)`, []any{policyVersionID, tenant, policyID, key, actor}},
		{`INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision) VALUES ($1, 1)`, []any{actor}},
		{`INSERT INTO authz.authorization_grants (actor_id, tenant_id, grant_kind, grant_source_id, authz_revision) VALUES ($1, $2, 'tenant', $2, 1)`, []any{actor, tenant}},
		{`UPDATE authz.authorization_projection_resync_state SET projection_ready = true, active_resync_id = gen_random_uuid(), completion_event_id = gen_random_uuid(),
		  expected_snapshot_count = 0, expected_manifest_sha256 = decode(repeat('00', 32), 'hex') WHERE singleton = true`, nil},
	} {
		_, err := pool.Exec(ctx, statement.sql, statement.args...)
		require.NoError(t, err, statement.sql)
	}
	exam := func(status string) uuid.UUID {
		examID, versionID := uuid.New(), uuid.New()
		_, err := pool.Exec(ctx, `INSERT INTO assessment.exams (id, tenant_id, created_by) VALUES ($1, $2, $3)`, examID, tenant, actor)
		require.NoError(t, err)
		_, err = pool.Exec(ctx, `INSERT INTO assessment.exam_versions (id, tenant_id, exam_id, version_number, title, instructions_markdown, opens_at, closes_at, duration_seconds, proctor_policy_version_id, created_by)
			VALUES ($1, $2, $3, 1, 't', 'i', now(), now() + interval '30 days', 3600, $4, $5)`, versionID, tenant, examID, policyVersionID, actor)
		require.NoError(t, err)
		if status != "draft" {
			_, err = pool.Exec(ctx, `UPDATE assessment.exam_versions SET status = $2, published_at = now() WHERE id = $1`, versionID, status)
			require.NoError(t, err)
		}
		return examID
	}
	store, err := repo.NewPostgres(pool)
	require.NoError(t, err)
	remove := func(examID uuid.UUID, reason string) error {
		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer tx.Rollback(ctx) //nolint:errcheck
		contextID := uuid.New()
		_, err = tx.Exec(ctx, `INSERT INTO authz.request_contexts (context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id, authz_revision, action, resource, issued_at, expires_at)
			VALUES ($1, $2, pg_backend_pid(), txid_current(), $3, $4, 1, 'assessment.write', 'assessment.exams', clock_timestamp(), clock_timestamp() + interval '4 seconds')`,
			contextID, uuid.New(), actor, tenant)
		require.NoError(t, err)
		_, err = tx.Exec(ctx, `SELECT set_config('app.authz_context_id', $1, true)`, contextID.String())
		require.NoError(t, err)
		_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_assessment_app`)
		require.NoError(t, err)
		if err := store.SoftDeleteExam(ctx, tx, app.DeleteExam{ID: examID.String(), TenantID: tenant.String(), ActorID: actor.String(), Reason: reason}); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	deleted := func(table, column string, id uuid.UUID) bool {
		var gone bool
		require.NoError(t, pool.QueryRow(ctx, `SELECT bool_and(deleted_at IS NOT NULL) FROM `+table+` WHERE `+column+` = $1`, id).Scan(&gone))
		return gone
	}

	draft := exam("draft")
	require.NoError(t, remove(draft, "created by mistake"))
	require.True(t, deleted("assessment.exams", "id", draft))
	require.True(t, deleted("assessment.exam_versions", "exam_id", draft), "the draft version goes with its exam")
	require.Error(t, remove(draft, "twice"), "an exam deletes once")

	for _, status := range []string{"published", "retired"} {
		kept := exam(status)
		err := remove(kept, "tidying")
		require.ErrorContains(t, err, "deleting a published exam is not allowed", status)
		require.False(t, deleted("assessment.exams", "id", kept), "a %s exam is untouched", status)
		require.False(t, deleted("assessment.exam_versions", "exam_id", kept), "its versions are untouched", status)
	}
}
