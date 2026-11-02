//go:build integration

package repo_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

// Sub-categories nest one level, names are unique among siblings, and the counts roll up (ADR-0058).
func TestCategoryHierarchy(t *testing.T) {
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
	create := func(name string, parent any) (map[string]any, error) {
		return call("qbank.categories", `SELECT qbank.create_category($1, $2, $3)`, uuid.New(), name, parent)
	}
	mustCreate := func(name string, parent any) string {
		created, err := create(name, parent)
		require.NoError(t, err)
		return created["id"].(string)
	}

	algorithms := mustCreate("Algorithms", nil)
	databases := mustCreate("Databases", nil)
	trees := mustCreate("Trees", algorithms)

	// "Basics" may exist under each parent, but only once among siblings, in any letter case.
	basicsAlgorithms := mustCreate("Basics", algorithms)
	require.NotEqual(t, basicsAlgorithms, mustCreate("Basics", databases))
	again, err := create(" bASICS ", algorithms)
	require.NoError(t, err)
	require.Equal(t, false, again["created"])
	require.Equal(t, basicsAlgorithms, again["id"])
	require.Equal(t, algorithms, again["parent_id"])
	topBasics := mustCreate("Basics", nil)
	require.NotEqual(t, basicsAlgorithms, topBasics, "a top-level name does not collide with a sub-category's")

	// Two levels at most; Uncategorised stays flat; a missing parent is refused.
	_, err = create("Binary", trees)
	requirePgCode(t, err, "55000")
	_, err = create("Misc", uncategorised)
	requirePgCode(t, err, "55000")
	_, err = create("Orphan", uuid.New())
	requirePgCode(t, err, "P0002")
	_, err = call("qbank.category_management", `SELECT qbank.move_category($1, $2)`, uncategorised, algorithms)
	requirePgCode(t, err, "55000")

	// Moving: a category with children cannot become a child; a sub-category moves up or across.
	_, err = call("qbank.category_management", `SELECT qbank.move_category($1, $2)`, algorithms, databases)
	requirePgCode(t, err, "55000")
	_, err = call("qbank.category_management", `SELECT qbank.move_category($1, $2)`, algorithms, algorithms)
	requirePgCode(t, err, "55000")
	_, err = call("qbank.category_management", `SELECT qbank.move_category($1, $2)`, basicsAlgorithms, databases)
	requirePgCode(t, err, "55000") // Databases already has a "Basics"
	_, err = call("qbank.category_management", `SELECT qbank.move_category($1, NULL)`, basicsAlgorithms)
	requirePgCode(t, err, "55000") // top level already has a "Basics"
	moved, err := call("qbank.category_management", `SELECT qbank.move_category($1, $2)`, trees, databases)
	require.NoError(t, err)
	require.Equal(t, databases, moved["parent_id"])
	_, err = call("qbank.categories", `SELECT qbank.move_category($1, NULL)`, trees)
	requirePgCode(t, err, "42501") // moving is administrators only

	// Renaming checks siblings, not the whole library.
	_, err = call("qbank.category_management", `SELECT qbank.rename_category($1, 'trees')`, basicsAlgorithms)
	require.NoError(t, err)
	_, err = call("qbank.category_management", `SELECT qbank.rename_category($1, 'Basics')`, trees)
	requirePgCode(t, err, "55000")

	// A question may sit under a parent or a sub-category; counts are own, with a total on top-level items.
	for slug, category := range map[string]string{"in-trees": trees, "in-parent": databases} {
		_, err = call("qbank.questions", `SELECT qbank.create_question($1, $2, $3, $4, 'T', 'P', 'easy', '["python3"]'::jsonb, 1000, 65536, NULL, NULL, NULL, '[]'::jsonb, $5)`,
			uuid.New(), uuid.New(), uuid.New(), slug, category)
		require.NoError(t, err)
	}
	var listed []byte
	require.NoError(t, asWriter(ctx, pool, actor, "qbank.categories", func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT qbank.list_categories()`).Scan(&listed)
	}))
	var items []map[string]any
	require.NoError(t, json.Unmarshal(listed, &items))
	byID := map[string]map[string]any{}
	for _, item := range items {
		byID[item["id"].(string)] = item
	}
	require.EqualValues(t, 1, byID[databases]["question_count"])
	require.EqualValues(t, 2, byID[databases]["question_count_total"])
	require.EqualValues(t, 1, byID[trees]["question_count"])
	require.Equal(t, databases, byID[trees]["parent_id"])
	require.NotContains(t, byID[trees], "question_count_total")
	require.Nil(t, byID[databases]["parent_id"])

	// Delete is refused while it has sub-categories; once they are gone, it merges as before.
	_, err = call("qbank.category_management", `SELECT qbank.delete_category($1, NULL)`, databases)
	requirePgCode(t, err, "55000")
	for _, child := range []string{trees, basicsAlgorithms} {
		_, err = call("qbank.category_management", `SELECT qbank.delete_category($1, NULL)`, child)
		require.NoError(t, err)
	}
	var childrenLeft int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM qbank.categories WHERE parent_id = $1`, databases).Scan(&childrenLeft))
	require.Equal(t, 1, childrenLeft, "the Basics sub-category under Databases remains")
}

// The down migration refuses rather than merging same-named siblings, and restores the flat schema otherwise.
func TestCategoryParentDownMigration(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := newMigratedPool(ctx, t)
	down, err := os.ReadFile(filepath.Join(migrationsDirectory(t), "000025_category_parent.down.sql"))
	require.NoError(t, err)

	_, err = pool.Exec(ctx, `INSERT INTO qbank.categories (id, name, normalized_name, parent_id) VALUES
		('00000000-0000-4000-8000-0000000000a1', 'A', 'a', NULL), ('00000000-0000-4000-8000-0000000000a2', 'B', 'b', NULL),
		('00000000-0000-4000-8000-0000000000b1', 'Basics', 'basics', '00000000-0000-4000-8000-0000000000a1'),
		('00000000-0000-4000-8000-0000000000b2', 'Basics', 'basics', '00000000-0000-4000-8000-0000000000a2')`)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, string(down))
	requirePgCode(t, err, "55000")

	_, err = pool.Exec(ctx, `DELETE FROM qbank.categories WHERE id = '00000000-0000-4000-8000-0000000000b2'`)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, string(down))
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO qbank.categories (id, name, normalized_name) VALUES (gen_random_uuid(), 'Basics', 'basics')`)
	requirePgCode(t, err, "23505")
}
