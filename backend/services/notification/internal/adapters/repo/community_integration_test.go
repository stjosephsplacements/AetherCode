//go:build integration

package repo_test

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/aethercode/aethercode/libs/pkg/testutil/integration"
)

func newMigratedPool(ctx context.Context, t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := integration.StartPostgres(ctx, t)
	for _, role := range []string{"owner", "migrator", "app", "authz_reader", "projection_worker", "retention_worker"} {
		_, err := pool.Exec(ctx, `CREATE ROLE aether_notification_`+role+` NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`)
		require.NoError(t, err)
	}
	for _, stmt := range []string{
		`GRANT aether_notification_owner TO aether_notification_migrator`,
		`ALTER DATABASE testdb OWNER TO aether_notification_owner`,
		`ALTER SCHEMA public OWNER TO aether_notification_owner`,
		`CREATE TABLE public.schema_migrations (version bigint NOT NULL PRIMARY KEY, dirty boolean NOT NULL)`,
		`ALTER TABLE public.schema_migrations OWNER TO aether_notification_owner`,
	} {
		_, err := pool.Exec(ctx, stmt)
		require.NoError(t, err, stmt)
	}
	_, file, _, _ := runtime.Caller(0)
	dir, err := filepath.Abs(filepath.Join(filepath.Dir(file), "../../../migrations"))
	require.NoError(t, err)
	integration.ApplyMigrations(ctx, t, pool, dir)
	return pool
}

// grant makes the actor a member of the tenant in the local authorization projection.
func grant(ctx context.Context, t *testing.T, pool *pgxpool.Pool, actor, tenant uuid.UUID) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision, snapshot_applied)
		VALUES ($1, 1, true) ON CONFLICT (actor_id) DO UPDATE SET snapshot_applied = true`, actor)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `
		INSERT INTO authz.actor_tenant_authorizations (actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id)
		VALUES ($1, $2, 1, true, 'tenant', $2)`, actor, tenant)
	require.NoError(t, err)
}

func projectionReady(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		UPDATE authz.authorization_projection_resync_state
		SET projection_ready = true, active_resync_id = gen_random_uuid(), completion_event_id = gen_random_uuid(),
		    expected_snapshot_count = 0, expected_manifest_sha256 = decode(repeat('00', 32), 'hex')
		WHERE singleton = true`)
	require.NoError(t, err)
}

// call runs one community function under a signed-context stand-in for the actor.
func call(ctx context.Context, pool *pgxpool.Pool, actor, tenant uuid.UUID, resource, action, function string, args any) (json.RawMessage, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	contextID := uuid.New()
	if _, err := tx.Exec(ctx, `
		INSERT INTO authz.request_contexts
		    (context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id, authz_revision, action, resource, issued_at, expires_at)
		VALUES ($1, $2, pg_backend_pid(), txid_current(), $3, $4, 1, $5, $6, clock_timestamp(), clock_timestamp() + interval '4 seconds')`,
		contextID, uuid.New(), actor, tenant, "notification."+action, "notification."+resource); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `SELECT set_config('app.authz_context_id', $1, true)`, contextID.String()); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `SET LOCAL ROLE aether_notification_app`); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(args)
	if err != nil {
		return nil, err
	}
	var raw json.RawMessage
	if err := tx.QueryRow(ctx, `SELECT notification.`+function+`($1, $2::jsonb)`, tenant, string(encoded)).Scan(&raw); err != nil {
		return nil, err
	}
	return raw, tx.Commit(ctx)
}

func pgCode(t *testing.T, err error, code string) {
	t.Helper()
	var pgErr *pgconn.PgError
	require.True(t, errors.As(err, &pgErr), "want a PostgreSQL error, got %T: %v", err, err)
	require.Equal(t, code, pgErr.Code, pgErr.Message)
}

type rows []map[string]any

func decode(t *testing.T, raw json.RawMessage) rows {
	t.Helper()
	var out rows
	require.NoError(t, json.Unmarshal(raw, &out))
	return out
}

func object(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	var out map[string]any
	require.NoError(t, json.Unmarshal(raw, &out))
	return out
}

// TestCommunity covers ADR-0048's database side.
func TestCommunity(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := newMigratedPool(ctx, t)
	projectionReady(ctx, t, pool)

	tenant, otherTenant := uuid.New(), uuid.New()
	student, classmate, staff, outsider := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	for _, actor := range []uuid.UUID{student, classmate, staff} {
		grant(ctx, t, pool, actor, tenant)
	}
	grant(ctx, t, pool, outsider, otherTenant)

	member := func(actor uuid.UUID, action, function string, args any) (json.RawMessage, error) {
		return call(ctx, pool, actor, tenant, "community", action, function, args)
	}
	moderator := func(actor uuid.UUID, action, function string, args any) (json.RawMessage, error) {
		return call(ctx, pool, actor, tenant, "community_moderation", action, function, args)
	}

	// Interview experiences: pending until staff approve; authors stay anonymous.
	submitted, err := member(student, "write", "community_experience_submit", map[string]any{
		"company": "Acme", "role": "SDE", "verdict": "selected", "tips": "Practise graphs.",
		"rounds": []map[string]string{{"title": "Online test", "description": "Two coding questions."}},
	})
	require.NoError(t, err)
	experience := object(t, submitted)
	require.Equal(t, "pending", experience["status"])
	require.Equal(t, true, experience["mine"])
	require.Nil(t, experience["author_id"])
	_, err = member(student, "write", "community_experience_submit", map[string]any{"company": "Acme", "role": "SDE", "rounds": []any{}})
	pgCode(t, err, "22023")
	_, err = member(student, "write", "community_experience_submit", map[string]any{
		"company": "Acme", "role": "SDE", "verdict": "hired", "rounds": []map[string]string{{"title": "HR"}},
	})
	pgCode(t, err, "22023")

	list, err := member(classmate, "read", "community_experience_list", map[string]any{})
	require.NoError(t, err)
	require.Empty(t, decode(t, list), "a classmate sees nothing before approval")
	list, err = member(student, "read", "community_experience_list", map[string]any{"mine": true})
	require.NoError(t, err)
	require.Len(t, decode(t, list), 1)

	_, err = member(student, "read", "community_experience_queue", map[string]any{})
	pgCode(t, err, "42501") // a member context is not a moderation context
	_, err = moderator(student, "write", "community_experience_review", map[string]any{"id": experience["id"], "approve": true})
	// The signed context only exists for staff in practice; the function still binds to the resource, so a
	// context for the moderation resource is what matters. This one is allowed here and proves the review itself.
	require.NoError(t, err)
	list, err = member(classmate, "read", "community_experience_list", map[string]any{"company": "acm"})
	require.NoError(t, err)
	require.Len(t, decode(t, list), 1)
	queue, err := moderator(staff, "read", "community_experience_queue", map[string]any{})
	require.NoError(t, err)
	require.Empty(t, decode(t, queue))
	_, err = member(classmate, "write", "community_experience_delete_own", map[string]any{"id": experience["id"]})
	pgCode(t, err, "P0002") // only the author deletes
	_, err = member(student, "write", "community_experience_delete_own", map[string]any{"id": experience["id"]})
	require.NoError(t, err)

	// Another college's contexts reach nothing here.
	_, err = call(ctx, pool, outsider, tenant, "community", "read", "community_experience_list", map[string]any{})
	pgCode(t, err, "42501")

	// Posts: drafts stay hidden from members.
	draft, err := moderator(staff, "write", "community_post_save", map[string]any{"title": "Draft", "body_markdown": "hello", "tags": []string{"Go", "go"}})
	require.NoError(t, err)
	post := object(t, draft)
	require.Equal(t, []any{"go"}, post["tags"])
	list, err = member(student, "read", "community_posts_list", map[string]any{})
	require.NoError(t, err)
	require.Empty(t, decode(t, list))
	_, err = member(student, "read", "community_post_get", map[string]any{"id": post["id"]})
	pgCode(t, err, "P0002")
	_, err = moderator(staff, "write", "community_post_save", map[string]any{"id": post["id"], "title": "Hello", "body_markdown": "# Hi", "status": "published"})
	require.NoError(t, err)
	got, err := member(student, "read", "community_post_get", map[string]any{"id": post["id"]})
	require.NoError(t, err)
	require.Equal(t, "# Hi", object(t, got)["body_markdown"])

	// Feed: saving with the same external ID updates one listing; bookmarks are per member.
	soon := time.Now().Add(48 * time.Hour).UTC().Format(time.RFC3339)
	saveContest := func(title string) json.RawMessage {
		saved, err := moderator(staff, "write", "community_feed_save", map[string]any{
			"kind": "contest", "title": title, "url": "https://codeforces.com/contests/1", "platform": "Codeforces",
			"starts_at": soon, "external_id": "cf-1", "tags": []string{"rated"},
		})
		require.NoError(t, err)
		return saved
	}
	item := object(t, saveContest("Round 1"))
	saveContest("Round 1 (renamed)")
	feed, err := member(student, "read", "community_feed_list", map[string]any{"kind": "contest", "upcoming": true})
	require.NoError(t, err)
	require.Len(t, decode(t, feed), 1)
	require.Equal(t, "Round 1 (renamed)", decode(t, feed)[0]["title"])
	require.Equal(t, "upcoming", decode(t, feed)[0]["phase"])
	_, err = moderator(staff, "write", "community_feed_save", map[string]any{"kind": "contest", "title": "x", "url": "ftp://nope"})
	pgCode(t, err, "22023")
	_, err = moderator(staff, "write", "community_feed_save", map[string]any{
		"kind": "hackathon", "title": "Backwards", "url": "https://example.com", "starts_at": soon, "ends_at": time.Now().UTC().Format(time.RFC3339)})
	pgCode(t, err, "22023")
	_, err = member(student, "write", "community_bookmark_set", map[string]any{"id": item["id"], "on": true})
	require.NoError(t, err)
	feed, err = member(student, "read", "community_feed_list", map[string]any{"bookmarked": true})
	require.NoError(t, err)
	require.Len(t, decode(t, feed), 1)
	feed, err = member(classmate, "read", "community_feed_list", map[string]any{"bookmarked": true})
	require.NoError(t, err)
	require.Empty(t, decode(t, feed))

	// Linked handles.
	_, err = member(student, "write", "community_link_set", map[string]any{"platform": "github", "handle": "octocat"})
	require.NoError(t, err)
	_, err = member(student, "write", "community_link_set", map[string]any{"platform": "myspace", "handle": "tom"})
	pgCode(t, err, "22023")
	_, err = member(student, "write", "community_link_set", map[string]any{"platform": "github", "handle": "bad handle!"})
	pgCode(t, err, "22023")
	links, err := member(student, "read", "community_links_get", map[string]any{})
	require.NoError(t, err)
	require.Equal(t, "octocat", decode(t, links)[0]["handle"])
	links, err = member(classmate, "read", "community_links_get", map[string]any{})
	require.NoError(t, err)
	require.Empty(t, decode(t, links))

	// Tasks belong to their owner.
	created, err := member(student, "write", "community_task_create", map[string]any{"title": "Mock test", "due_at": soon})
	require.NoError(t, err)
	task := object(t, created)
	_, err = member(classmate, "write", "community_task_update", map[string]any{"id": task["id"], "done": true})
	pgCode(t, err, "P0002")
	updated, err := member(student, "write", "community_task_update", map[string]any{"id": task["id"], "done": true})
	require.NoError(t, err)
	require.Equal(t, true, object(t, updated)["done"])
	_, err = member(student, "write", "community_task_delete", map[string]any{"id": task["id"]})
	require.NoError(t, err)

	// The application role cannot read the tables directly.
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx) //nolint:errcheck
	_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_notification_app`)
	require.NoError(t, err)
	var count int
	err = tx.QueryRow(ctx, `SELECT count(*) FROM notification.community_experiences`).Scan(&count)
	pgCode(t, err, "42501")
	_ = pgx.ErrNoRows
}
