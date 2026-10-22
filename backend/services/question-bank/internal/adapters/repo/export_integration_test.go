//go:build integration

package repo_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

// TestExportQuestionVersion covers ADR-0032: an export needs a write context
// on question_exports, records who exported what, and returns the bundle
// references only to that context.
func TestExportQuestionVersion(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := newMigratedPool(ctx, t)

	actorID, questionID, versionID := uuid.New(), uuid.New(), uuid.New()
	_, err := pool.Exec(ctx, `INSERT INTO qbank.questions (id, slug, created_by) VALUES ($1, 'export-question', $2)`, questionID, actorID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `
		INSERT INTO qbank.question_versions
		    (id, question_id, version_number, title, prompt_markdown, difficulty,
		     supported_languages, time_limit_ms, memory_limit_kib, created_by)
		VALUES ($1, $2, 1, 'Sum', 'Print a + b.', 'easy', '["python3"]'::jsonb, 1000, 65536, $3)`, versionID, questionID, actorID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `
		INSERT INTO authz.actor_global_authorizations (actor_id, authz_revision, can_read, can_write, active)
		VALUES ($1, 1, true, true, true)`, actorID)
	require.NoError(t, err)
	markAuthorizationProjectionReady(ctx, t, pool)
	require.NoError(t, asWriter(ctx, pool, actorID, "qbank.test_case_manifests", func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT * FROM qbank.set_question_version_tests($1, 1, 'eval', repeat('a', 64), 'local:k',
			'sample', repeat('b', 64), 'local:k', 1, 'hidden', repeat('c', 64), 'local:k', 1)`, versionID)
		return err
	}))

	export := func(resource string) (map[string]any, error) {
		var response map[string]any
		err := asWriter(ctx, pool, actorID, resource, func(tx pgx.Tx) error {
			var raw []byte
			if err := tx.QueryRow(ctx, `SELECT qbank.export_question_version($1, $2)`, uuid.New(), versionID).Scan(&raw); err != nil {
				return err
			}
			return json.Unmarshal(raw, &response)
		})
		return response, err
	}

	_, err = export("qbank.question_versions")
	requirePgCode(t, err, "42501")

	response, err := export("qbank.question_exports")
	require.NoError(t, err)
	require.Equal(t, "Sum", response["title"])
	require.Equal(t, "eval", response["evaluation"].(map[string]any)["object_key"])
	require.Equal(t, "sample", response["sample"].(map[string]any)["object_key"])

	var exports int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM qbank.question_export_events WHERE question_version_id = $1 AND actor_id = $2`,
		versionID, actorID).Scan(&exports))
	require.Equal(t, 1, exports, "a refused export is not recorded; an export is")
}
