//go:build integration

package repo_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/aethercode/aethercode/libs/pkg/testutil/integration"
)

const uncategorised = "018f4b0d-08f8-7c09-9ba7-efdf9c220c01"

// migrationsUpTo copies the migrations numbered at most version into a directory of their own.
func migrationsUpTo(t *testing.T, version int) string {
	t.Helper()
	target := t.TempDir()
	entries, err := os.ReadDir(migrationsDirectory(t))
	require.NoError(t, err)
	for _, entry := range entries {
		number, err := strconv.Atoi(strings.SplitN(entry.Name(), "_", 2)[0])
		if err != nil || number > version {
			continue
		}
		content, err := os.ReadFile(filepath.Join(migrationsDirectory(t), entry.Name()))
		require.NoError(t, err)
		require.NoError(t, os.WriteFile(filepath.Join(target, entry.Name()), content, 0o600))
	}
	return target
}

func names(t *testing.T, ctx context.Context, pool interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, query string, args ...any) []string {
	t.Helper()
	rows, err := pool.Query(ctx, query, args...)
	require.NoError(t, err)
	defer rows.Close()
	var found []string
	for rows.Next() {
		var name string
		require.NoError(t, rows.Scan(&name))
		found = append(found, name)
	}
	require.NoError(t, rows.Err())
	return found
}

// TestCategoryMigrationKeepsExistingData is the production rollout in miniature:
// start from the schema as it is today (migration 21), fill it the way real use
// has, then apply the category migration (ADR-0052).
func TestCategoryMigrationKeepsExistingData(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := newPreparedPool(ctx, t)
	integration.ApplyMigrations(ctx, t, pool, migrationsUpTo(t, 21))

	actor, tagged, bare := uuid.New(), uuid.New(), uuid.New()
	versionOne, versionTwo, bareVersion := uuid.New(), uuid.New(), uuid.New()
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO qbank.questions (id, slug, created_by) VALUES ($1, 'two-sum', $2), ($3, 'plain', $2)`, []any{tagged, actor, bare}},
		{`INSERT INTO qbank.question_versions (id, question_id, version_number, title, prompt_markdown, difficulty, supported_languages, time_limit_ms, memory_limit_kib, created_by)
		  VALUES ($1, $2, 1, 'Two sum', 'p', 'easy', '["python3"]', 1000, 65536, $5),
		         ($3, $2, 2, 'Two sum', 'p', 'easy', '["python3"]', 1000, 65536, $5),
		         ($4, $6, 1, 'Plain', 'p', 'easy', '["python3"]', 1000, 65536, $5)`, []any{versionOne, tagged, versionTwo, bareVersion, actor, bare}},
		{`INSERT INTO qbank.tags (id, name, normalized_name)
		  VALUES ('00000000-0000-4000-8000-000000000001', 'arrays', 'arrays'),
		         ('00000000-0000-4000-8000-000000000002', 'sorting', 'sorting'),
		         ('00000000-0000-4000-8000-000000000003', 'hashing', 'hashing')`, nil},
		// Version 1 had arrays and sorting; version 2, the newest, arrays and hashing.
		{`INSERT INTO qbank.question_version_tags (question_version_id, tag_id) VALUES
		    ($1, '00000000-0000-4000-8000-000000000001'), ($1, '00000000-0000-4000-8000-000000000002'),
		    ($2, '00000000-0000-4000-8000-000000000001'), ($2, '00000000-0000-4000-8000-000000000003')`, []any{versionOne, versionTwo}},
	} {
		_, err := pool.Exec(ctx, statement.sql, statement.args...)
		require.NoError(t, err, statement.sql)
	}

	integration.ApplyMigrations(ctx, t, pool, migrationsDirectory(t)) // 22 onwards

	require.Equal(t, []string{uncategorised, uncategorised},
		names(t, ctx, pool, `SELECT category_id::text FROM qbank.questions ORDER BY slug`), "every existing question lands in Uncategorised")
	require.Equal(t, []string{"arrays", "hashing"},
		names(t, ctx, pool, `SELECT tag.name FROM qbank.question_tags qt JOIN qbank.tags tag ON tag.id = qt.tag_id WHERE qt.question_id = $1 ORDER BY tag.name`, tagged),
		"a question keeps the tags of its newest version, not the union of all of them")
	require.Empty(t, names(t, ctx, pool, `SELECT tag_id::text FROM qbank.question_tags WHERE question_id = $1`, bare))
	require.Equal(t, []string{"Uncategorised"}, names(t, ctx, pool, `SELECT name FROM qbank.categories`))

	// A pod still on the previous release inserts a question without a category.
	oldPod := uuid.New()
	_, err := pool.Exec(ctx, `INSERT INTO qbank.questions (id, slug, created_by) VALUES ($1, 'from-an-old-pod', $2)`, oldPod, actor)
	require.NoError(t, err)
	require.Equal(t, []string{uncategorised}, names(t, ctx, pool, `SELECT category_id::text FROM qbank.questions WHERE id = $1`, oldPod))
}

func TestCategoriesAndQuestionTags(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := newMigratedPool(ctx, t)
	actor := uuid.New()
	_, err := pool.Exec(ctx, `INSERT INTO authz.actor_global_authorizations (actor_id, authz_revision, can_read, can_write, active) VALUES ($1, 1, true, true, true)`, actor)
	require.NoError(t, err)
	markAuthorizationProjectionReady(ctx, t, pool)

	call := func(resource, sql string, args ...any) (map[string]any, error) {
		var raw []byte
		err := asWriter(ctx, pool, actor, resource, func(tx pgx.Tx) error { return tx.QueryRow(ctx, sql, args...).Scan(&raw) })
		var decoded map[string]any
		if err == nil && len(raw) > 0 {
			require.NoError(t, json.Unmarshal(raw, &decoded))
		}
		return decoded, err
	}
	newQuestion := func(slug, categoryID, tags string) (uuid.UUID, map[string]any) {
		questionID := uuid.New()
		var category any
		if categoryID != "" {
			category = categoryID
		}
		response, err := call("qbank.questions", `SELECT qbank.create_question($1, $2, $3, $4, 'T', 'P', 'easy', '["python3"]'::jsonb, 1000, 65536, NULL, NULL, NULL, $5::jsonb, $6)`,
			questionID, uuid.New(), uuid.New(), slug, tags, category)
		require.NoError(t, err)
		return questionID, response
	}
	tag := func(id, name string) string { return `{"id":"` + id + `","name":"` + name + `"}` }
	tagNames := func(questionID uuid.UUID) []string {
		return names(t, ctx, pool, `SELECT tag.name FROM qbank.question_tags qt JOIN qbank.tags tag ON tag.id = qt.tag_id WHERE qt.question_id = $1 ORDER BY tag.name`, questionID)
	}

	// Adding a category is open to authors; the same name in any letter case is the same category.
	arrays, err := call("qbank.categories", `SELECT qbank.create_category($1, 'Arrays')`, uuid.New())
	require.NoError(t, err)
	require.Equal(t, true, arrays["created"])
	again, err := call("qbank.categories", `SELECT qbank.create_category($1, '  aRRays ')`, uuid.New())
	require.NoError(t, err)
	require.Equal(t, false, again["created"])
	require.Equal(t, arrays["id"], again["id"])
	_, err = call("qbank.categories", `SELECT qbank.create_category($1, '   ')`, uuid.New())
	requirePgCode(t, err, "22023")

	// Renaming, merging and deleting need the management resource an author's capability does not carry.
	arraysID := arrays["id"].(string)
	_, err = call("qbank.categories", `SELECT qbank.rename_category($1, 'Lists')`, arraysID)
	requirePgCode(t, err, "42501")
	_, err = call("qbank.categories", `SELECT qbank.delete_category($1, NULL)`, arraysID)
	requirePgCode(t, err, "42501")

	// A question is filed where it is created; without a category it is Uncategorised.
	inArrays, response := newQuestion("two-sum", arraysID, `[`+tag("00000000-0000-4000-8000-0000000000a1", "hashing")+`]`)
	require.Equal(t, "Arrays", response["question"].(map[string]any)["category"].(map[string]any)["name"])
	loose, response := newQuestion("loose", "", `[]`)
	require.Equal(t, "Uncategorised", response["question"].(map[string]any)["category"].(map[string]any)["name"])

	// Tags belong to the question: a new draft with no tags leaves them alone, clearing is explicit,
	// and they can change on a question that is already published.
	require.Equal(t, []string{"hashing"}, tagNames(inArrays))
	require.NoError(t, asWriter(ctx, pool, actor, "qbank.question_versions", func(tx pgx.Tx) error {
		var raw []byte
		return tx.QueryRow(ctx, `SELECT qbank.create_draft_question_version($1, $2, $3, 1, 'T2', 'P', 'easy', '["python3"]'::jsonb, 1000, 65536, NULL, NULL, NULL, '[]'::jsonb)`,
			uuid.New(), uuid.New(), inArrays).Scan(&raw)
	}))
	require.Equal(t, []string{"hashing"}, tagNames(inArrays), "a new version with no tags does not wipe the question's")
	updated, err := call("qbank.questions", `SELECT qbank.set_question_tags($1, $2::jsonb)`, inArrays, `[`+tag("00000000-0000-4000-8000-0000000000b1", "two-pointers")+`,`+tag("00000000-0000-4000-8000-0000000000b2", "hashing")+`]`)
	require.NoError(t, err)
	require.Len(t, updated["tags"], 2)
	require.Equal(t, []string{"hashing", "two-pointers"}, tagNames(inArrays))
	_, err = call("qbank.questions", `SELECT qbank.set_question_tags($1, '[]'::jsonb)`, inArrays)
	require.NoError(t, err)
	require.Empty(t, tagNames(inArrays), "an explicit empty list clears them")
	_, err = call("qbank.questions", `SELECT qbank.set_question_tags($1, '[{"id":"x"}]'::jsonb)`, inArrays)
	require.Error(t, err)

	// Categories move with set_question_category, and only to categories that exist.
	_, err = call("qbank.questions", `SELECT qbank.set_question_category($1, $2)`, loose, arraysID)
	require.NoError(t, err)
	_, err = call("qbank.questions", `SELECT qbank.set_question_category($1, $2)`, loose, uuid.New())
	requirePgCode(t, err, "P0002")

	// The management resource renames, merges and deletes; Uncategorised is built in.
	renamed, err := call("qbank.category_management", `SELECT qbank.rename_category($1, ' Array   Problems ')`, arraysID)
	require.NoError(t, err)
	require.Equal(t, "Array Problems", renamed["name"])
	stringsCategory, err := call("qbank.categories", `SELECT qbank.create_category($1, 'Strings')`, uuid.New())
	require.NoError(t, err)
	_, err = call("qbank.category_management", `SELECT qbank.rename_category($1, 'strings')`, arraysID)
	requirePgCode(t, err, "55000")
	_, err = call("qbank.category_management", `SELECT qbank.rename_category($1, 'Anything')`, uncategorised)
	requirePgCode(t, err, "55000")
	_, err = call("qbank.category_management", `SELECT qbank.delete_category($1, NULL)`, uncategorised)
	requirePgCode(t, err, "55000")
	_, err = call("qbank.category_management", `SELECT qbank.delete_category($1, $1)`, arraysID)
	requirePgCode(t, err, "55000")

	merged, err := call("qbank.category_management", `SELECT qbank.delete_category($1, $2)`, arraysID, stringsCategory["id"])
	require.NoError(t, err)
	require.EqualValues(t, 2, merged["moved"])
	require.Equal(t, []string{stringsCategory["id"].(string), stringsCategory["id"].(string)},
		names(t, ctx, pool, `SELECT category_id::text FROM qbank.questions WHERE id = ANY($1) ORDER BY slug`, []uuid.UUID{inArrays, loose}))
	emptied, err := call("qbank.category_management", `SELECT qbank.delete_category($1, NULL)`, stringsCategory["id"])
	require.NoError(t, err)
	require.EqualValues(t, 2, emptied["moved"])
	require.Equal(t, []string{uncategorised, uncategorised},
		names(t, ctx, pool, `SELECT category_id::text FROM qbank.questions WHERE id = ANY($1) ORDER BY slug`, []uuid.UUID{inArrays, loose}), "deleting without a target files them under Uncategorised")

	listed, err := call("qbank.categories", `SELECT jsonb_build_object('categories', qbank.list_categories())`)
	require.NoError(t, err)
	require.Len(t, listed["categories"], 1)
}

// A version's summary says where its question is filed, so the workbench can show and change it.
func TestVersionSummaryCarriesCategoryAndTags(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := newMigratedPool(ctx, t)
	actor, questionID, versionID := uuid.New(), uuid.New(), uuid.New()
	_, err := pool.Exec(ctx, `INSERT INTO authz.actor_global_authorizations (actor_id, authz_revision, can_read, can_write, active) VALUES ($1, 1, true, true, true)`, actor)
	require.NoError(t, err)
	markAuthorizationProjectionReady(ctx, t, pool)
	require.NoError(t, asWriter(ctx, pool, actor, "qbank.questions", func(tx pgx.Tx) error {
		var raw []byte
		return tx.QueryRow(ctx, `SELECT qbank.create_question($1, $2, $3, 'dp-one', 'T', 'P', 'easy', '["python3"]'::jsonb, 1000, 65536, NULL, NULL, NULL,
			'[{"id":"00000000-0000-4000-8000-0000000000c1","name":"memo"}]'::jsonb, NULL)`, questionID, versionID, uuid.New()).Scan(&raw)
	}))
	var summary map[string]any
	require.NoError(t, asWriter(ctx, pool, actor, "qbank.question_versions", func(tx pgx.Tx) error {
		var raw []byte
		if err := tx.QueryRow(ctx, `SELECT qbank.get_question_version($1)`, versionID).Scan(&raw); err != nil {
			return err
		}
		return json.Unmarshal(raw, &summary)
	}))
	require.Equal(t, uncategorised, summary["category_id"])
	require.Equal(t, "Uncategorised", summary["category"].(map[string]any)["name"])
	require.Equal(t, "memo", summary["tags"].([]any)[0].(map[string]any)["name"])
}
