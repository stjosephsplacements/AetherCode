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

// TestRepinExamItem proves ADR-0039: an item of a published exam takes a
// corrected version of its own question, nothing else about the published
// exam can change, and every assignment, started ones included, is re-sent
// with the corrected bundle.
func TestRepinExamItem(t *testing.T) {
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
	itemID := addItem(fixedSection, 1, "10")
	must(`UPDATE assessment.exam_sections SET draw_count = NULL WHERE id = $1`, poolSection)
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
	require.NoError(t, publish())

	var questionID uuid.UUID
	require.NoError(t, tx.QueryRow(ctx, `SELECT question_id FROM assessment.exam_items WHERE id = $1`, itemID).Scan(&questionID))
	ruleID, assignmentID := uuid.New(), uuid.New()
	must(`INSERT INTO assessment.assignment_rules (id, tenant_id, exam_version_id, target_type, target_id, available_from, available_until, created_by)
	      VALUES ($1, $2, $3, 'student', $4, now(), now() + interval '20 days', $5)`, ruleID, tenant, versionID, uuid.New(), actor)
	must(`INSERT INTO assessment.candidate_assignments (id, tenant_id, assignment_rule_id, exam_version_id, candidate_id, available_from, available_until, lifecycle_state)
	      VALUES ($1, $2, $3, $4, $5, now(), now() + interval '20 days', 'started')`, assignmentID, tenant, ruleID, versionID, uuid.New())

	must(`SAVEPOINT direct`)
	require.Error(t, exec(`UPDATE assessment.exam_items SET maximum_score = 99 WHERE id = $1`, itemID), "a published exam stays immutable")
	must(`ROLLBACK TO SAVEPOINT direct`)

	newKey := strings.Repeat("c", 64)
	repin := func(question uuid.UUID) error {
		useContext("assessment.exam_items")
		must(`SAVEPOINT repin`)
		must(`SET LOCAL ROLE aether_assessment_app`)
		_, err := tx.Exec(ctx, `SELECT assessment.repin_exam_item(gen_random_uuid(), $1, $2, $3, $4, $5, 'qb/eval-v2.bin', $6, 'local/key-2',
		      'qb/sample-v2.bin', $6, 'local/key-2', 3000, 262144, ARRAY['python3'], 'Fixed', 'Solve, fixed.')`,
			tenant, versionID, itemID, question, uuid.New(), newKey)
		if err != nil {
			must(`ROLLBACK TO SAVEPOINT repin`)
			return err
		}
		must(`RESET ROLE`)
		return nil
	}
	require.Error(t, repin(uuid.New()), "only a version of the item's own question")
	must(`DELETE FROM app.outbox_events`)
	require.NoError(t, repin(questionID))

	var marks string
	require.NoError(t, tx.QueryRow(ctx, `SELECT maximum_score::text FROM assessment.exam_items WHERE id = $1`, itemID).Scan(&marks))
	require.Equal(t, "10.0000", marks)
	var payload []byte
	require.NoError(t, tx.QueryRow(ctx, `SELECT payload FROM app.outbox_events WHERE event_type = 'assessment.candidate_assignment.snapshot.v1'`).Scan(&payload))
	var snapshot struct {
		LifecycleState string           `json:"lifecycle_state"`
		Items          []map[string]any `json:"items"`
	}
	require.NoError(t, json.Unmarshal(payload, &snapshot))
	require.Equal(t, "active", snapshot.LifecycleState, "a started assignment is re-sent as active")
	require.Equal(t, newKey, snapshot.Items[0]["evaluation_bundle_checksum"])
	require.Equal(t, "Fixed", snapshot.Items[0]["title"])

	// ADR-0040: the rule's window moves, and its assignments follow.
	move := func(until string) error {
		useContext("assessment.assignment_rules")
		must(`SAVEPOINT move`)
		must(`SET LOCAL ROLE aether_assessment_app`)
		_, err := tx.Exec(ctx, `SELECT assessment.move_assignment_window(gen_random_uuid(), $1, $2, now() + $3::interval)`, tenant, ruleID, until)
		if err != nil {
			must(`ROLLBACK TO SAVEPOINT move`)
			return err
		}
		must(`RESET ROLE`)
		return nil
	}
	require.Error(t, move("40 days"), "at most 30 days after the window opens")
	must(`DELETE FROM app.outbox_events`)
	require.NoError(t, move("25 days"))
	var moved bool
	require.NoError(t, tx.QueryRow(ctx, `SELECT available_until > now() + interval '24 days' FROM assessment.candidate_assignments WHERE id = $1`, assignmentID).Scan(&moved))
	require.True(t, moved)
	var events int
	require.NoError(t, tx.QueryRow(ctx, `SELECT count(*) FROM app.outbox_events WHERE event_type = 'assessment.candidate_assignment.snapshot.v1'`).Scan(&events))
	require.Equal(t, 1, events, "the moved assignment is re-sent")
}
