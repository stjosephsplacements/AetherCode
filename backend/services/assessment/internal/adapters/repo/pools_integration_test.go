//go:build integration

package repo_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestQuestionPools proves ADR-0034: a pool section gives each student
// draw_count of its questions, a student's draw is stable across snapshots,
// different students get different draws, and publication refuses a pool
// that is too small or mixes marks.
func TestQuestionPools(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := migratedPool(ctx, t)

	tenant, actor := uuid.New(), uuid.New()
	policyID, policyVersionID, examID := uuid.New(), uuid.New(), uuid.New()
	versionID, fixedSection, poolSection := uuid.New(), uuid.New(), uuid.New()
	key := strings.Repeat("a", 64)

	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx) //nolint:errcheck
	exec := func(query string, args ...any) error {
		t.Helper()
		_, execErr := tx.Exec(ctx, query, args...)
		return execErr
	}
	must := func(query string, args ...any) {
		t.Helper()
		require.NoError(t, exec(query, args...), query)
	}

	must(`INSERT INTO assessment.proctor_policies (id, tenant_id, name, created_by) VALUES ($1, $2, 'p', $3)`, policyID, tenant, actor)
	must(`INSERT INTO assessment.proctor_policy_versions (id, tenant_id, proctor_policy_id, version_number, policy, policy_checksum, status, published_at, created_by)
	      VALUES ($1, $2, $3, 1, '{}', $4, 'published', now(), $5)`, policyVersionID, tenant, policyID, key, actor)
	must(`INSERT INTO assessment.exams (id, tenant_id, created_by) VALUES ($1, $2, $3)`, examID, tenant, actor)
	must(`INSERT INTO assessment.exam_versions (id, tenant_id, exam_id, version_number, title, instructions_markdown, opens_at, closes_at, duration_seconds, proctor_policy_version_id, created_by)
	      VALUES ($1, $2, $3, 1, 't', 'i', now(), now() + interval '30 days', 3600, $4, $5)`, versionID, tenant, examID, policyVersionID, actor)
	must(`INSERT INTO assessment.exam_sections (id, tenant_id, exam_version_id, position, title) VALUES ($1, $2, $3, 1, 'Everyone')`, fixedSection, tenant, versionID)
	must(`INSERT INTO assessment.exam_sections (id, tenant_id, exam_version_id, position, title, draw_count) VALUES ($1, $2, $3, 2, 'Pool', 2)`, poolSection, tenant, versionID)

	must(`INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision) VALUES ($1, 1)`, actor)
	must(`INSERT INTO authz.authorization_grants (actor_id, tenant_id, grant_kind, grant_source_id, authz_revision) VALUES ($1, $2, 'tenant', $2, 1)`, actor, tenant)
	must(`UPDATE authz.authorization_projection_resync_state
	      SET projection_ready = true, active_resync_id = gen_random_uuid(), completion_event_id = gen_random_uuid(),
	          expected_snapshot_count = 0, expected_manifest_sha256 = decode(repeat('00', 32), 'hex')
	      WHERE singleton = true`)
	useContext := func(resource string) {
		t.Helper()
		contextID := uuid.New()
		must(`INSERT INTO authz.request_contexts (context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id, authz_revision, action, resource, issued_at, expires_at)
		      VALUES ($1, $2, pg_backend_pid(), txid_current(), $3, $4, 1, 'assessment.write', $5, clock_timestamp(), clock_timestamp() + interval '4 seconds')`,
			contextID, uuid.New(), actor, tenant, resource)
		must(`SELECT set_config('app.authz_context_id', $1, true)`, contextID.String())
	}
	contentVersion := 1
	addItem := func(section uuid.UUID, position int, marks string) uuid.UUID {
		t.Helper()
		itemID := uuid.New()
		useContext("assessment.exam_items")
		must(`SET LOCAL ROLE aether_assessment_app`)
		must(`SELECT assessment.add_exam_item($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, 'qb/eval.bin', $10, 'local/key-1', 'qb/sample.bin', $10, 'local/key-1',
		      2000, 262144, ARRAY['python3'], 'Q', 'Solve.')`,
			itemID, tenant, versionID, section, contentVersion, position, uuid.New(), uuid.New(), marks, key)
		must(`RESET ROLE`)
		contentVersion++
		return itemID
	}
	addItem(fixedSection, 1, "10")
	poolItems := map[string]bool{}
	for position := 1; position <= 5; position++ {
		poolItems[addItem(poolSection, position, "5").String()] = true
	}

	publish := func() error {
		t.Helper()
		useContext("assessment.exam_versions")
		must(`SAVEPOINT publish`)
		must(`SET LOCAL ROLE aether_assessment_app`)
		err := exec(`SELECT assessment.publish_exam_version($1, $2, $3, gen_random_uuid())`, tenant, versionID, contentVersion)
		if err != nil {
			must(`ROLLBACK TO SAVEPOINT publish`)
			return err
		}
		must(`RESET ROLE`)
		return nil
	}
	// Mixed marks in a pool would give students different totals.
	must(`UPDATE assessment.exam_items SET maximum_score = 7 WHERE id = (SELECT id FROM assessment.exam_items WHERE section_id = $1 LIMIT 1)`, poolSection)
	require.ErrorContains(t, publish(), "pool")
	must(`UPDATE assessment.exam_items SET maximum_score = 5 WHERE section_id = $1`, poolSection)
	must(`UPDATE assessment.exam_sections SET draw_count = 6 WHERE id = $1`, poolSection)
	require.ErrorContains(t, publish(), "pool")
	must(`UPDATE assessment.exam_sections SET draw_count = 2 WHERE id = $1`, poolSection)
	require.NoError(t, publish())

	ruleID := uuid.New()
	must(`INSERT INTO assessment.assignment_rules (id, tenant_id, exam_version_id, target_type, target_id, available_from, available_until, created_by)
	      VALUES ($1, $2, $3, 'student', $4, now(), now() + interval '20 days', $5)`, ruleID, tenant, versionID, uuid.New(), actor)
	draw := func(assignmentID uuid.UUID) []string {
		t.Helper()
		must(`DELETE FROM app.outbox_events`)
		must(`SELECT assessment.enqueue_candidate_assignment_snapshot(gen_random_uuid(), $1, $2)`, tenant, assignmentID)
		var payload []byte
		require.NoError(t, tx.QueryRow(ctx, `SELECT payload FROM app.outbox_events WHERE event_type = 'assessment.candidate_assignment.snapshot.v1'`).Scan(&payload))
		var snapshot struct {
			Items []struct {
				ExamItemID string `json:"exam_item_id"`
			} `json:"items"`
		}
		require.NoError(t, json.Unmarshal(payload, &snapshot))
		ids := []string{}
		for _, item := range snapshot.Items {
			ids = append(ids, item.ExamItemID)
		}
		return ids
	}
	draws := map[string]bool{}
	for range 8 {
		assignmentID := uuid.New()
		must(`INSERT INTO assessment.candidate_assignments (id, tenant_id, assignment_rule_id, exam_version_id, candidate_id, available_from, available_until)
		      VALUES ($1, $2, $3, $4, $5, now(), now() + interval '20 days')`, assignmentID, tenant, ruleID, versionID, uuid.New())
		items := draw(assignmentID)
		require.Len(t, items, 3, "the fixed question plus two from the pool")
		pooled := 0
		for _, id := range items {
			if poolItems[id] {
				pooled++
			}
		}
		require.Equal(t, 2, pooled)
		require.Equal(t, items, draw(assignmentID), "a student's draw never changes")
		draws[strings.Join(items, ",")] = true
	}
	require.Greater(t, len(draws), 1, "students get different questions")
}
