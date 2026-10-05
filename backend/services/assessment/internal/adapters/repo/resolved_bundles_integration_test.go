//go:build integration

package repo_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

// TestResolvedBundlesAreSnapshotted proves that an item added through
// add_exam_item pins both bundles with their key references plus the execution
// limits and languages, and that every snapshot builder carries them to
// Submission.
func TestResolvedBundlesAreSnapshotted(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := migratedPool(ctx, t)

	tenant, actor, student, batch := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	policyID, policyVersionID, examID, versionID, sectionID, itemID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	questionID, questionVersionID, ruleID := uuid.New(), uuid.New(), uuid.New()
	evalKey, sampleKey := strings.Repeat("a", 64), strings.Repeat("b", 64)

	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx) //nolint:errcheck
	exec := func(query string, args ...any) {
		t.Helper()
		_, execErr := tx.Exec(ctx, query, args...)
		require.NoError(t, execErr, query)
	}

	exec(`INSERT INTO assessment.proctor_policies (id, tenant_id, name, created_by) VALUES ($1, $2, 'p', $3)`, policyID, tenant, actor)
	exec(`INSERT INTO assessment.proctor_policy_versions (id, tenant_id, proctor_policy_id, version_number, policy, policy_checksum, status, published_at, created_by)
	      VALUES ($1, $2, $3, 1, '{}', $4, 'published', now(), $5)`, policyVersionID, tenant, policyID, evalKey, actor)
	exec(`INSERT INTO assessment.exams (id, tenant_id, created_by) VALUES ($1, $2, $3)`, examID, tenant, actor)
	exec(`INSERT INTO assessment.exam_versions (id, tenant_id, exam_id, version_number, title, instructions_markdown, opens_at, closes_at, duration_seconds, proctor_policy_version_id, created_by)
	      VALUES ($1, $2, $3, 1, 't', 'i', now(), now() + interval '30 days', 3600, $4, $5)`, versionID, tenant, examID, policyVersionID, actor)
	exec(`INSERT INTO assessment.exam_sections (id, tenant_id, exam_version_id, position, title) VALUES ($1, $2, $3, 1, 's')`, sectionID, tenant, versionID)

	// Authorize the app role for assessment.write on exam items (bypasses the HMAC gate).
	exec(`INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision) VALUES ($1, 1)`, actor)
	exec(`INSERT INTO authz.authorization_grants (actor_id, tenant_id, grant_kind, grant_source_id, authz_revision) VALUES ($1, $2, 'tenant', $2, 1)`, actor, tenant)
	exec(`UPDATE authz.authorization_projection_resync_state
	      SET projection_ready = true, active_resync_id = gen_random_uuid(), completion_event_id = gen_random_uuid(),
	          expected_snapshot_count = 0, expected_manifest_sha256 = decode(repeat('00', 32), 'hex')
	      WHERE singleton = true`)
	contextID := uuid.New()
	exec(`INSERT INTO authz.request_contexts (context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id, authz_revision, action, resource, issued_at, expires_at)
	      VALUES ($1, $2, pg_backend_pid(), txid_current(), $3, $4, 1, 'assessment.write', 'assessment.exam_items', clock_timestamp(), clock_timestamp() + interval '4 seconds')`,
		contextID, uuid.New(), actor, tenant)
	exec(`SELECT set_config('app.authz_context_id', $1, true)`, contextID.String())

	addItem := func(sampleObjectKey any, keyReference any, timeLimit any) error {
		_, addErr := tx.Exec(ctx, `SAVEPOINT add_item`)
		require.NoError(t, addErr)
		_, addErr = tx.Exec(ctx, `SET LOCAL ROLE aether_assessment_app`)
		require.NoError(t, addErr)
		_, addErr = tx.Exec(ctx, `SELECT assessment.add_exam_item($1, $2, $3, $4, 1, 1, $5, $6, 10::numeric, 'qb/eval.bin', $7, $8, $9, $10, $11, $12, $13, $14)`,
			itemID, tenant, versionID, sectionID, questionID, questionVersionID, evalKey, keyReference, sampleObjectKey, sampleKey, keyReference,
			timeLimit, 262144, []string{"c", "python3"})
		if addErr != nil {
			// Rolling back to the savepoint also restores the session role.
			_, rollbackErr := tx.Exec(ctx, `ROLLBACK TO SAVEPOINT add_item`)
			require.NoError(t, rollbackErr)
			return addErr
		}
		_, resetErr := tx.Exec(ctx, `RESET ROLE`)
		require.NoError(t, resetErr)
		return addErr
	}
	require.Error(t, addItem(nil, "local/key-1", 2000), "a missing sample bundle must be rejected")
	require.Error(t, addItem("qb/sample.bin", nil, 2000), "a missing key reference must be rejected")
	require.Error(t, addItem("qb/sample.bin", "local/key-1", nil), "missing execution limits must be rejected")
	require.Error(t, addItem("qb/sample.bin", "local/key-1", 0), "an out-of-range time limit must be rejected")
	require.NoError(t, addItem("qb/sample.bin", "local/key-1", 2000))

	var hasLegacy bool
	require.NoError(t, tx.QueryRow(ctx, `SELECT has_function_privilege('aether_assessment_app',
		'assessment.add_exam_item(uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text, text, text, text, text, text)', 'EXECUTE')`).Scan(&hasLegacy))
	require.False(t, hasLegacy, "the overload without execution limits must not be executable by the app role")

	exec(`UPDATE assessment.exam_versions SET status = 'published', published_at = now() WHERE id = $1`, versionID)
	exec(`INSERT INTO assessment.assignment_rules (id, tenant_id, exam_version_id, target_type, target_id, available_from, available_until, created_by)
	      VALUES ($1, $2, $3, 'batch', $4, now(), now() + interval '20 days', $5)`, ruleID, tenant, versionID, batch, actor)

	snapshotItem := func(query string, args ...any) map[string]any {
		t.Helper()
		exec(`DELETE FROM app.outbox_events`)
		exec(query, args...)
		return outboxItem(t, ctx, tx)
	}
	want := map[string]any{
		"exam_item_id":                    itemID.String(),
		"evaluation_bundle_object_key":    "qb/eval.bin",
		"evaluation_bundle_checksum":      evalKey,
		"evaluation_bundle_key_reference": "local/key-1",
		"sample_bundle_object_key":        "qb/sample.bin",
		"sample_bundle_checksum":          sampleKey,
		"sample_bundle_key_reference":     "local/key-1",
		"maximum_score":                   float64(10),
		"time_limit_ms":                   float64(2000),
		"memory_limit_kib":                float64(262144),
		"supported_languages":             []any{"c", "python3"},
	}

	// Direct materialization goes through enqueue_candidate_assignment_snapshot.
	directRuleID := uuid.New()
	exec(`INSERT INTO assessment.assignment_rules (id, tenant_id, exam_version_id, target_type, target_id, available_from, available_until, created_by)
	      VALUES ($1, $2, $3, 'student', $4, now(), now() + interval '20 days', $5)`, directRuleID, tenant, versionID, uuid.New(), actor)
	assignmentID := uuid.New()
	exec(`INSERT INTO assessment.candidate_assignments (id, tenant_id, assignment_rule_id, exam_version_id, candidate_id, available_from, available_until)
	      VALUES ($1, $2, $3, $4, $5, now(), now() + interval '20 days')`, assignmentID, tenant, directRuleID, versionID, uuid.New())
	require.Equal(t, want, snapshotItem(`SELECT assessment.enqueue_candidate_assignment_snapshot(gen_random_uuid(), $1, $2)`, tenant, assignmentID))

	// Joining a batch materializes against the principal, not the student record.
	principal := uuid.New()
	require.Equal(t, want, snapshotItem(`SELECT assessment.materialize_from_batch_affiliation(gen_random_uuid(), $1, $2, $3, $4, 'active', 2)`,
		tenant, student, principal, batch))
	var candidates int
	require.NoError(t, tx.QueryRow(ctx, `SELECT count(*) FROM assessment.candidate_assignments WHERE assignment_rule_id = $1 AND candidate_id = $2`,
		ruleID, principal).Scan(&candidates))
	require.Equal(t, 1, candidates, "the candidate is the student's principal")

	// An older, redelivered snapshot cannot undo the newer membership.
	exec(`SELECT assessment.materialize_from_batch_affiliation(gen_random_uuid(), $1, $2, $3, NULL, 'inactive', 1)`, tenant, student, principal)
	var status string
	require.NoError(t, tx.QueryRow(ctx, `SELECT status FROM assessment.student_batch_enrollments WHERE tenant_id = $1 AND student_id = $2`,
		tenant, student).Scan(&status))
	require.Equal(t, "active", status)

	// A rule created after students joined reaches every one of them.
	laterBatch, firstStudent, firstPrincipal, secondStudent, secondPrincipal, laterRuleID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	exec(`SELECT assessment.materialize_from_batch_affiliation(gen_random_uuid(), $1, $2, $3, $4, 'active', 1)`, tenant, firstStudent, firstPrincipal, laterBatch)
	exec(`SELECT assessment.materialize_from_batch_affiliation(gen_random_uuid(), $1, $2, $3, $4, 'active', 1)`, tenant, secondStudent, secondPrincipal, laterBatch)
	exec(`INSERT INTO assessment.assignment_rules (id, tenant_id, exam_version_id, target_type, target_id, available_from, available_until, created_by)
	      VALUES ($1, $2, $3, 'batch', $4, now(), now() + interval '20 days', $5)`, laterRuleID, tenant, versionID, laterBatch, actor)
	exec(`SELECT assessment.backfill_from_assignment_rule(gen_random_uuid(), $1, $2, 'batch', $3)`, tenant, laterRuleID, laterBatch)
	require.NoError(t, tx.QueryRow(ctx, `SELECT count(*) FROM assessment.candidate_assignments WHERE assignment_rule_id = $1 AND candidate_id IN ($2, $3)`,
		laterRuleID, firstPrincipal, secondPrincipal).Scan(&candidates))
	require.Equal(t, 2, candidates, "backfill materializes the existing roster by principal")
}

func outboxItem(t *testing.T, ctx context.Context, tx pgx.Tx) map[string]any {
	t.Helper()
	var payload []byte
	require.NoError(t, tx.QueryRow(ctx, `SELECT payload FROM app.outbox_events WHERE event_type = 'assessment.candidate_assignment.snapshot.v1'`).Scan(&payload))
	var snapshot struct {
		ExamVersionID   string           `json:"exam_version_id"`
		DurationSeconds *int             `json:"duration_seconds"`
		Items           []map[string]any `json:"items"`
	}
	require.NoError(t, json.Unmarshal(payload, &snapshot))
	var duration int
	require.NoError(t, tx.QueryRow(ctx, `SELECT duration_seconds FROM assessment.exam_versions WHERE id = $1`,
		snapshot.ExamVersionID).Scan(&duration))
	require.NotNil(t, snapshot.DurationSeconds, "Submission derives each candidate's deadline from it")
	require.Equal(t, duration, *snapshot.DurationSeconds)
	require.Len(t, snapshot.Items, 1)
	return snapshot.Items[0]
}
