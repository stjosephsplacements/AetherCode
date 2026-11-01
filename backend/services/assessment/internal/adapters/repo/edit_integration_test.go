//go:build integration

package repo_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/aethercode/aethercode/services/assessment/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/assessment/internal/app"
)

// TestEditingADraftExam covers ADR-0054: a draft exam's details, a section and a
// question's marks change through the signed write context, each bumps the content
// version, a stale version is refused, and a published exam cannot be edited.
func TestEditingADraftExam(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := migratedPool(ctx, t)
	tenant, actor := uuid.New(), uuid.New()
	policyID, policyVersionID := uuid.New(), uuid.New()
	key := "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90"
	examID, versionID, sectionID, itemID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO assessment.proctor_policies (id, tenant_id, name, created_by) VALUES ($1, $2, 'p', $3)`, []any{policyID, tenant, actor}},
		{`INSERT INTO assessment.proctor_policy_versions (id, tenant_id, proctor_policy_id, version_number, policy, policy_checksum, status, published_at, created_by)
		  VALUES ($1, $2, $3, 1, '{}', $4, 'published', now(), $5)`, []any{policyVersionID, tenant, policyID, key, actor}},
		{`INSERT INTO assessment.exams (id, tenant_id, created_by) VALUES ($1, $2, $3)`, []any{examID, tenant, actor}},
		{`INSERT INTO assessment.exam_versions (id, tenant_id, exam_id, version_number, title, instructions_markdown, opens_at, closes_at, duration_seconds, proctor_policy_version_id, created_by)
		  VALUES ($1, $2, $3, 1, 'Old title', 'Old instructions', now(), now() + interval '30 days', 3600, $4, $5)`, []any{versionID, tenant, examID, policyVersionID, actor}},
		{`INSERT INTO assessment.exam_sections (id, tenant_id, exam_version_id, position, title) VALUES ($1, $2, $3, 1, 'Part A')`, []any{sectionID, tenant, versionID}},
		{`INSERT INTO assessment.exam_items (id, tenant_id, exam_version_id, section_id, position, question_id, question_version_id, maximum_score, evaluation_bundle_checksum)
		  VALUES ($1, $2, $3, $4, 1, gen_random_uuid(), gen_random_uuid(), 10, $5)`, []any{itemID, tenant, versionID, sectionID, key}},
		{`INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision) VALUES ($1, 1)`, []any{actor}},
		{`INSERT INTO authz.authorization_grants (actor_id, tenant_id, grant_kind, grant_source_id, authz_revision) VALUES ($1, $2, 'tenant', $2, 1)`, []any{actor, tenant}},
		{`UPDATE authz.authorization_projection_resync_state SET projection_ready = true, active_resync_id = gen_random_uuid(), completion_event_id = gen_random_uuid(),
		  expected_snapshot_count = 0, expected_manifest_sha256 = decode(repeat('00', 32), 'hex') WHERE singleton = true`, nil},
	} {
		_, err := pool.Exec(ctx, statement.sql, statement.args...)
		require.NoError(t, err, statement.sql)
	}
	store, err := repo.NewPostgres(pool)
	require.NoError(t, err)

	asWriter := func(resource string, fn func(pgx.Tx) error) error {
		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer tx.Rollback(ctx) //nolint:errcheck
		contextID := uuid.New()
		_, err = tx.Exec(ctx, `INSERT INTO authz.request_contexts (context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id, authz_revision, action, resource, issued_at, expires_at)
			VALUES ($1, $2, pg_backend_pid(), txid_current(), $3, $4, 1, 'assessment.write', $5, clock_timestamp(), clock_timestamp() + interval '4 seconds')`,
			contextID, uuid.New(), actor, tenant, resource)
		require.NoError(t, err)
		_, err = tx.Exec(ctx, `SELECT set_config('app.authz_context_id', $1, true)`, contextID.String())
		require.NoError(t, err)
		_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_assessment_app`)
		require.NoError(t, err)
		if err := fn(tx); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	contentVersion := func() int64 {
		var value int64
		require.NoError(t, pool.QueryRow(ctx, `SELECT content_version FROM assessment.exam_versions WHERE id = $1`, versionID).Scan(&value))
		return value
	}
	text := func(s string) *string { return &s }
	whole := func(n int) *int { return &n }

	start := contentVersion()
	closes := time.Now().Add(48 * time.Hour)
	require.NoError(t, asWriter("assessment.exam_versions", func(tx pgx.Tx) error {
		return store.UpdateExamVersion(ctx, tx, app.UpdateExamVersion{ID: versionID.String(), TenantID: tenant.String(), ExpectedContentVersion: start, Title: text("  Mid-term "), ClosesAt: &closes, DurationSeconds: whole(5400)})
	}))
	var title, instructions string
	var duration int
	require.NoError(t, pool.QueryRow(ctx, `SELECT title, instructions_markdown, duration_seconds FROM assessment.exam_versions WHERE id = $1`, versionID).Scan(&title, &instructions, &duration))
	require.Equal(t, "Mid-term", title)
	require.Equal(t, "Old instructions", instructions, "a field left out stays as it was")
	require.Equal(t, 5400, duration)
	require.Equal(t, start+1, contentVersion())

	err = asWriter("assessment.exam_versions", func(tx pgx.Tx) error {
		return store.UpdateExamVersion(ctx, tx, app.UpdateExamVersion{ID: versionID.String(), TenantID: tenant.String(), ExpectedContentVersion: start, Title: text("Stale")})
	})
	require.Error(t, err, "the content version moved on")

	require.NoError(t, asWriter("assessment.exam_sections", func(tx pgx.Tx) error {
		return store.UpdateExamSection(ctx, tx, app.UpdateExamSection{ID: sectionID.String(), TenantID: tenant.String(), ExamVersionID: versionID.String(), ExpectedContentVersion: start + 1, Title: text("Coding"), TimeLimitSeconds: whole(1800)})
	}))
	var limit *int
	require.NoError(t, pool.QueryRow(ctx, `SELECT time_limit_seconds FROM assessment.exam_sections WHERE id = $1`, sectionID).Scan(&limit))
	require.NotNil(t, limit)
	require.Equal(t, 1800, *limit)
	require.NoError(t, asWriter("assessment.exam_sections", func(tx pgx.Tx) error {
		return store.UpdateExamSection(ctx, tx, app.UpdateExamSection{ID: sectionID.String(), TenantID: tenant.String(), ExamVersionID: versionID.String(), ExpectedContentVersion: start + 2, ClearTimeLimit: true})
	}))
	require.NoError(t, pool.QueryRow(ctx, `SELECT time_limit_seconds FROM assessment.exam_sections WHERE id = $1`, sectionID).Scan(&limit))
	require.Nil(t, limit, "the time limit can be cleared")

	require.NoError(t, asWriter("assessment.exam_items", func(tx pgx.Tx) error {
		return store.UpdateExamItem(ctx, tx, app.UpdateExamItem{ID: itemID.String(), TenantID: tenant.String(), ExamVersionID: versionID.String(), ExpectedContentVersion: start + 3, MaximumScore: "12.5"})
	}))
	var score string
	require.NoError(t, pool.QueryRow(ctx, `SELECT maximum_score::text FROM assessment.exam_items WHERE id = $1`, itemID).Scan(&score))
	require.Equal(t, "12.5000", score)
	require.Equal(t, start+4, contentVersion())

	// A capability for another resource cannot edit, and a published exam never changes.
	err = asWriter("assessment.exams", func(tx pgx.Tx) error {
		return store.UpdateExamItem(ctx, tx, app.UpdateExamItem{ID: itemID.String(), TenantID: tenant.String(), ExamVersionID: versionID.String(), ExpectedContentVersion: start + 4, MaximumScore: "1"})
	})
	require.Error(t, err)
	_, err = pool.Exec(ctx, `UPDATE assessment.exam_versions SET status = 'published', published_at = now() WHERE id = $1`, versionID)
	require.NoError(t, err)
	err = asWriter("assessment.exam_versions", func(tx pgx.Tx) error {
		return store.UpdateExamVersion(ctx, tx, app.UpdateExamVersion{ID: versionID.String(), TenantID: tenant.String(), ExpectedContentVersion: start + 4, Title: text("Too late")})
	})
	require.Error(t, err)
}
