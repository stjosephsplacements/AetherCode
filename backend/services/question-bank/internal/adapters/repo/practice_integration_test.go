//go:build integration

package repo_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// asStudent runs fn under a student's tenant-scoped practice context.
func asStudent(ctx context.Context, pool *pgxpool.Pool, actorID, tenantID uuid.UUID, action string, fn func(pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	contextID := uuid.New()
	if _, err := tx.Exec(ctx, `
		INSERT INTO authz.request_contexts
		    (context_id, capability_id, backend_pid, transaction_id,
		     actor_id, tenant_id, authz_revision, action, resource, issued_at, expires_at)
		VALUES ($1, $2, pg_backend_pid(), txid_current(), $3, $4, 1,
		        $5, 'qbank.practice_submissions', clock_timestamp(), clock_timestamp() + interval '4 seconds')`,
		contextID, uuid.New(), actorID, tenantID, action,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `SELECT set_config('app.authz_context_id', $1, true)`, contextID.String()); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `SET LOCAL ROLE aether_question_bank_app`); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// TestPractice covers ADR-0041's database side: students see only practice
// questions, never a test question or a staff function, runs are bound to the
// signed student, one job each is in flight, and progress counts solved ones.
func TestPractice(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := newMigratedPool(ctx, t)
	markAuthorizationProjectionReady(ctx, t, pool)

	staff, student, classmate, tenant := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	_, err := pool.Exec(ctx, `
		INSERT INTO authz.actor_global_authorizations (actor_id, authz_revision, can_read, can_write, active)
		VALUES ($1, 1, true, true, true)`, staff)
	require.NoError(t, err)

	publish := func(slug string) uuid.UUID {
		questionID, versionID := uuid.New(), uuid.New()
		_, err := pool.Exec(ctx, `INSERT INTO qbank.questions (id, slug, created_by, lifecycle_state) VALUES ($1, $2, $3, 'published')`, questionID, slug, staff)
		require.NoError(t, err)
		_, err = pool.Exec(ctx, `
			INSERT INTO qbank.question_versions
			    (id, question_id, version_number, title, prompt_markdown, difficulty, supported_languages,
			     time_limit_ms, memory_limit_kib, evaluation_bundle_object_key, evaluation_bundle_checksum,
			     encryption_key_reference, created_by)
			VALUES ($1, $2, 1, $3, 'Print a + b.', 'easy', '["python3"]'::jsonb, 1500, 65536,
			        'eval-' || $3, repeat('a', 64), 'local:k', $4)`, versionID, questionID, slug, staff)
		require.NoError(t, err)
		for _, kind := range []string{"sample", "hidden"} {
			_, err = pool.Exec(ctx, `
				INSERT INTO qbank.test_case_manifests
				    (id, question_version_id, manifest_kind, object_key, checksum, encryption_key_reference, test_case_count, created_by)
				VALUES ($1, $2, $3, $3 || '-' || $4, repeat('b', 64), 'local:k', 1, $5)`, uuid.New(), versionID, kind, slug, staff)
			require.NoError(t, err)
		}
		_, err = pool.Exec(ctx, `UPDATE qbank.question_versions SET status = 'published', published_at = clock_timestamp() WHERE id = $1`, versionID)
		require.NoError(t, err)
		return questionID
	}
	practice, secret := publish("two-sum"), publish("exam-only")

	// Staff mark one question for practice; the other stays a test question.
	require.NoError(t, asWriter(ctx, pool, staff, "qbank.questions", func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT qbank.set_question_audience($1, 'practice')`, practice)
		return err
	}))

	call := func(actor uuid.UUID, action, query string, arguments ...any) (json.RawMessage, error) {
		var raw json.RawMessage
		err := asStudent(ctx, pool, actor, tenant, action, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, query, arguments...).Scan(&raw)
		})
		return raw, err
	}

	raw, err := call(student, "qbank.read", `SELECT qbank.list_practice_questions()`)
	require.NoError(t, err)
	var catalogue []struct {
		QuestionID string `json:"question_id"`
		Solved     bool   `json:"solved"`
	}
	require.NoError(t, json.Unmarshal(raw, &catalogue))
	require.Len(t, catalogue, 1, "a test question never appears in practice")
	require.Equal(t, practice.String(), catalogue[0].QuestionID)

	_, err = call(student, "qbank.read", `SELECT qbank.get_practice_question($1)`, secret)
	requirePgCode(t, err, "P0002")
	raw, err = call(student, "qbank.read", `SELECT qbank.get_practice_question($1)`, practice)
	require.NoError(t, err)
	require.Contains(t, string(raw), "sample-two-sum")
	require.NotContains(t, string(raw), "eval-two-sum", "the evaluation bundle is never offered to a student")

	// A practice context reaches no staff function, and reads cannot start runs.
	_, err = call(student, "qbank.write", `SELECT qbank.get_question_version(id) FROM qbank.question_versions LIMIT 1`)
	require.Error(t, err)
	start := func(actor uuid.UUID, mode string) (json.RawMessage, error) {
		return call(actor, "qbank.write", `SELECT qbank.start_practice_submission($1, $2, 'python3', $3, false, 'src', repeat('d', 64), 'local:k')`,
			uuid.New(), practice, mode)
	}
	_, err = call(student, "qbank.read", `SELECT qbank.start_practice_submission($1, $2, 'python3', 'run', false, 'src', repeat('d', 64), 'local:k')`, uuid.New(), practice)
	requirePgCode(t, err, "42501")
	_, err = call(student, "qbank.write", `SELECT qbank.start_practice_submission($1, $2, 'python3', 'run', false, 'src', repeat('d', 64), 'local:k')`, uuid.New(), secret)
	requirePgCode(t, err, "P0002")

	raw, err = start(student, "submit")
	require.NoError(t, err)
	require.Contains(t, string(raw), "eval-two-sum")
	_, err = start(student, "run")
	requirePgCode(t, err, "55000") // one job in flight per student
	raw, err = start(classmate, "run")
	require.NoError(t, err)
	require.Contains(t, string(raw), "sample-two-sum")

	var submissionID string
	require.NoError(t, pool.QueryRow(ctx, `SELECT id::text FROM qbank.practice_submissions WHERE actor_id = $1`, student).Scan(&submissionID))
	worker, err := pool.Begin(ctx)
	require.NoError(t, err)
	_, err = worker.Exec(ctx, `SET LOCAL ROLE aether_question_bank_projection_worker`)
	require.NoError(t, err)
	var found bool
	require.NoError(t, worker.QueryRow(ctx, `SELECT qbank.finish_practice_submission($1, 'completed', 'accepted',
		'[{"unit_number":0,"verdict":"accepted","weight":1}]'::jsonb)`, submissionID).Scan(&found))
	require.True(t, found)
	require.NoError(t, worker.Commit(ctx))

	// Runs are the student's own.
	_, err = call(classmate, "qbank.read", `SELECT qbank.get_practice_submission($1)`, submissionID)
	requirePgCode(t, err, "P0002")
	raw, err = call(student, "qbank.read", `SELECT qbank.get_practice_submission($1)`, submissionID)
	require.NoError(t, err)
	require.Contains(t, string(raw), `"passed_units": 1`)
	raw, err = call(classmate, "qbank.read", `SELECT qbank.list_practice_submissions($1)`, practice)
	require.NoError(t, err)
	require.NotContains(t, string(raw), submissionID)

	raw, err = call(student, "qbank.read", `SELECT qbank.get_practice_progress()`)
	require.NoError(t, err)
	var progress struct {
		Available int `json:"available"`
		Solved    int `json:"solved"`
	}
	require.NoError(t, json.Unmarshal(raw, &progress))
	require.Equal(t, 1, progress.Available)
	require.Equal(t, 1, progress.Solved)

	// A signed context carries a tenant only for practice.
	_, err = pool.Exec(ctx, `SELECT authz.set_context($1, $2, 1, 'allow', $3, 'qbank.read', 'qbank.questions',
		clock_timestamp(), clock_timestamp() + interval '4 seconds', $4, decode(repeat('00', 32), 'hex'))`,
		student, tenant, uuid.New(), uuid.New())
	requirePgCode(t, err, "28000")
}
