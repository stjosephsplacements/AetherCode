//go:build integration

package repo_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/aethercode/aethercode/libs/pkg/testutil/integration"
)

const tenantID = "018f4b0d-08f8-7c09-9ba7-efdf9c350001"

func startSEBDatabase(ctx context.Context, t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := integration.StartPostgres(ctx, t)
	for _, statement := range []string{
		`CREATE ROLE aether_seb_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_seb_migrator NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_seb_app NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_seb_authz_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_seb_projection_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`GRANT aether_seb_owner TO aether_seb_migrator`,
		`ALTER DATABASE testdb OWNER TO aether_seb_owner`,
		`ALTER SCHEMA public OWNER TO aether_seb_owner`,
		`CREATE TABLE public.schema_migrations (version bigint NOT NULL PRIMARY KEY, dirty boolean NOT NULL)`,
		`ALTER TABLE public.schema_migrations OWNER TO aether_seb_owner`,
	} {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatalf("pre-migration setup %q: %v", statement, err)
		}
	}
	_, file, _, _ := runtime.Caller(0)
	integration.ApplyMigrations(ctx, t, pool, filepath.Join(filepath.Dir(file), "../../..", "migrations"))
	_, err := pool.Exec(ctx, `
		UPDATE authz.authorization_projection_resync_state
		SET projection_ready = true, active_resync_id = gen_random_uuid(),
		    completion_event_id = gen_random_uuid(), expected_snapshot_count = 0,
		    expected_manifest_sha256 = decode(repeat('00', 32), 'hex')
		WHERE singleton = true`)
	if err != nil {
		t.Fatalf("mark authorization projection ready: %v", err)
	}
	return pool
}

func authorize(ctx context.Context, t *testing.T, pool *pgxpool.Pool, actorID string) {
	t.Helper()
	for _, statement := range []string{
		`INSERT INTO authz.actor_tenant_authorizations (actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id)
		 VALUES ($1, $2, 1, true, 'tenant', $2)`,
		`INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision, snapshot_applied) VALUES ($1, 1, true)`,
	} {
		args := []any{actorID, tenantID}
		if !strings.Contains(statement, "$2") {
			args = args[:1]
		}
		if _, err := pool.Exec(ctx, statement, args...); err != nil {
			t.Fatalf("authorize %s: %v", actorID, err)
		}
	}
}

// signed runs fn as role inside a transaction carrying a signed context for
// actorID with the given action and resource, then commits.
func signed(ctx context.Context, t *testing.T, pool *pgxpool.Pool, role, actorID, action, resource string, fn func(pgx.Tx) error) error {
	t.Helper()
	transaction, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer transaction.Rollback(ctx) //nolint:errcheck
	var contextID string
	if err := transaction.QueryRow(ctx, `
		INSERT INTO authz.request_contexts
		    (context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id,
		     authz_revision, action, resource, issued_at, expires_at)
		VALUES (gen_random_uuid(), gen_random_uuid(), pg_backend_pid(), txid_current(), $1, $2, 1, $3, $4,
		        clock_timestamp(), clock_timestamp() + interval '4 seconds')
		RETURNING context_id::text`, actorID, tenantID, action, resource).Scan(&contextID); err != nil {
		t.Fatal(err)
	}
	if _, err := transaction.Exec(ctx, `SELECT set_config('app.authz_context_id', $1, true)`, contextID); err != nil {
		t.Fatal(err)
	}
	if _, err := transaction.Exec(ctx, `SET LOCAL ROLE `+role); err != nil {
		t.Fatal(err)
	}
	if err := fn(transaction); err != nil {
		return err
	}
	return transaction.Commit(ctx)
}

func snapshot(ctx context.Context, t *testing.T, pool *pgxpool.Pool, assignmentID, candidateID, examID, state, from, until string, version int) {
	t.Helper()
	transaction, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer transaction.Rollback(ctx) //nolint:errcheck
	if _, err := transaction.Exec(ctx, `SET LOCAL ROLE aether_seb_projection_worker`); err != nil {
		t.Fatal(err)
	}
	if _, err := transaction.Exec(ctx, `
		SELECT seb.apply_candidate_assignment_snapshot($1, $2, $3, $4,
		    clock_timestamp() + $5::interval, clock_timestamp() + $6::interval, $7, $8)`,
		tenantID, assignmentID, candidateID, examID, from, until, state, version); err != nil {
		t.Fatalf("apply snapshot: %v", err)
	}
	// The rest of what the lifecycle projection does as this role.
	if _, err := transaction.Exec(ctx, `
		INSERT INTO seb.projection_inbox_messages (consumer_name, event_id, payload_sha256, occurred_at)
		VALUES ('seb_assignment_snapshot_v2', gen_random_uuid(), decode(repeat('00', 32), 'hex'), clock_timestamp())`); err != nil {
		t.Fatalf("claim inbox message: %v", err)
	}
	if _, err := transaction.Exec(ctx, `SELECT seb.close_sessions_for_candidate(gen_random_uuid(), $1, $2, 'assignment_revoked')`,
		tenantID, candidateID); err != nil {
		t.Fatalf("close sessions: %v", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		t.Fatal(err)
	}
}

func hash(url, key string) string {
	sum := sha256.Sum256([]byte(url + key))
	return hex.EncodeToString(sum[:])
}

// TestExamLockdown drives the ADR-0022 flow through the database: staff lock
// an exam, the projection records the candidate's assignment, and only a
// request hashed with an accepted key for its own URL passes.
func TestExamLockdown(t *testing.T) {
	ctx := context.Background()
	pool := startSEBDatabase(ctx, t)
	staffID, candidateID, otherID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	examID, assignmentID := uuid.NewString(), uuid.NewString()
	for _, actor := range []string{staffID, candidateID, otherID} {
		authorize(ctx, t, pool, actor)
	}
	browserKey, configKey := strings.Repeat("ab", 32), strings.Repeat("cd", 32)
	const url = "https://exam.example/api/submission/v1/tenants/x/attempts?limit=5"

	check := func(actorID, requestHash, configKeyHash string) string {
		t.Helper()
		var result string
		if err := signed(ctx, t, pool, "aether_seb_app", actorID, "seb.read", "seb.sessions", func(transaction pgx.Tx) error {
			return transaction.QueryRow(ctx, `SELECT seb.check_exam_request($1, $2, NULLIF($3, ''), NULLIF($4, ''))`,
				tenantID, url, requestHash, configKeyHash).Scan(&result)
		}); err != nil {
			t.Fatalf("check_exam_request: %v", err)
		}
		return result
	}
	launchTitle := func(actorID string) *string {
		t.Helper()
		var title *string
		if err := signed(ctx, t, pool, "aether_seb_app", actorID, "seb.read", "seb.sessions", func(transaction pgx.Tx) error {
			return transaction.QueryRow(ctx, `SELECT seb.candidate_exam_launch($1, $2)`, tenantID, examID).Scan(&title)
		}); err != nil {
			t.Fatalf("candidate_exam_launch: %v", err)
		}
		return title
	}

	snapshot(ctx, t, pool, assignmentID, candidateID, examID, "active", "-1 hour", "1 hour", 1)
	if got := check(candidateID, "", ""); got != "not_required" {
		t.Fatalf("before the exam is locked: %s", got)
	}

	if err := signed(ctx, t, pool, "aether_seb_app", staffID, "seb.write", "seb.configurations", func(transaction pgx.Tx) error {
		_, err := transaction.Exec(ctx, `
			INSERT INTO seb.exam_policies (tenant_id, exam_id, title, enabled, accepted_keys, updated_by)
			VALUES ($1, $2, 'Mid term', true, $3, $4)`, tenantID, examID, []string{browserKey, configKey}, staffID)
		return err
	}); err != nil {
		t.Fatalf("lock exam: %v", err)
	}
	if err := signed(ctx, t, pool, "aether_seb_app", candidateID, "seb.write", "seb.validation_events", func(transaction pgx.Tx) error {
		_, err := transaction.Exec(ctx, `UPDATE seb.exam_policies SET enabled = false WHERE exam_id = $1`, examID)
		return err
	}); err != nil {
		t.Fatalf("candidate update: %v", err)
	}

	for name, testCase := range map[string]struct{ requestHash, configKeyHash, want string }{
		"no headers":               {"", "", "missing"},
		"browser exam key":         {hash(url, browserKey), "", "matched"},
		"config key":               {"", hash(url, configKey), "matched"},
		"hash for another URL":     {hash(url+"&page=2", browserKey), "", "mismatched"},
		"raw key instead of hash":  {browserKey, "", "mismatched"},
		"one good header suffices": {strings.Repeat("0", 64), hash(url, configKey), "matched"},
	} {
		if got := check(candidateID, testCase.requestHash, testCase.configKeyHash); got != testCase.want {
			t.Errorf("%s: got %s, want %s (a candidate cannot turn the lock off)", name, got, testCase.want)
		}
	}
	if got := check(otherID, "", ""); got != "not_required" {
		t.Errorf("unassigned candidate: got %s", got)
	}
	if title := launchTitle(candidateID); title == nil || *title != "Mid term" {
		t.Errorf("candidate launch title = %v", title)
	}
	if title := launchTitle(otherID); title != nil {
		t.Errorf("unassigned candidate got a launch file for %q", *title)
	}

	// An older snapshot never overwrites a newer one; revocation unlocks.
	snapshot(ctx, t, pool, assignmentID, candidateID, examID, "revoked", "-1 hour", "1 hour", 2)
	snapshot(ctx, t, pool, assignmentID, candidateID, examID, "active", "-1 hour", "1 hour", 1)
	if got := check(candidateID, "", ""); got != "not_required" {
		t.Errorf("after revocation: got %s", got)
	}
	// A closed window (past the five-minute tail) unlocks too.
	snapshot(ctx, t, pool, assignmentID, candidateID, examID, "active", "-2 hours", "-10 minutes", 3)
	if got := check(candidateID, "", ""); got != "not_required" {
		t.Errorf("after the window: got %s", got)
	}
	snapshot(ctx, t, pool, assignmentID, candidateID, examID, "active", "-2 hours", "-2 minutes", 4)
	if got := check(candidateID, "", ""); got != "missing" {
		t.Errorf("inside the tail: got %s", got)
	}

	// Without the sessions read capability the check fails closed.
	err := signed(ctx, t, pool, "aether_seb_app", candidateID, "seb.write", "seb.validation_events", func(transaction pgx.Tx) error {
		_, err := transaction.Exec(ctx, `SELECT seb.check_exam_request($1, $2, NULL, NULL)`, tenantID, url)
		return err
	})
	if err == nil || !strings.Contains(err.Error(), "42501") {
		t.Errorf("check without capability: %v", err)
	}
}
