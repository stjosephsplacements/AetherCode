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

	"github.com/stjosephsplacements/AetherCode/libs/pkg/testutil/integration"
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

// TestLabNetworks proves ADR-0030: an exam limited to lab networks refuses a
// candidate's requests from anywhere else, including from an unknown address,
// whether or not it is also locked to Safe Exam Browser.
func TestLabNetworks(t *testing.T) {
	ctx := context.Background()
	pool := startSEBDatabase(ctx, t)
	staffID, candidateID, otherID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	examID, assignmentID := uuid.NewString(), uuid.NewString()
	for _, actor := range []string{staffID, candidateID, otherID} {
		authorize(ctx, t, pool, actor)
	}
	const url = "https://exam.example/api/submission/v1/tenants/x/attempts"
	check := func(actorID, clientIP string) string {
		t.Helper()
		var result string
		if err := signed(ctx, t, pool, "aether_seb_app", actorID, "seb.read", "seb.sessions", func(transaction pgx.Tx) error {
			return transaction.QueryRow(ctx, `SELECT seb.check_exam_request($1, $2, NULL, NULL, NULLIF($3, '')::inet)`,
				tenantID, url, clientIP).Scan(&result)
		}); err != nil {
			t.Fatalf("check_exam_request: %v", err)
		}
		return result
	}
	snapshot(ctx, t, pool, assignmentID, candidateID, examID, "active", "-1 hour", "1 hour", 1)
	if err := signed(ctx, t, pool, "aether_seb_app", staffID, "seb.write", "seb.configurations", func(transaction pgx.Tx) error {
		_, err := transaction.Exec(ctx, `
			INSERT INTO seb.exam_policies (tenant_id, exam_id, title, enabled, accepted_keys, updated_by, allowed_networks)
			VALUES ($1, $2, 'Lab test', false, '{}', $3, '{10.20.0.0/16,192.0.2.7/32}')`, tenantID, examID, staffID)
		return err
	}); err != nil {
		t.Fatalf("limit exam to the lab: %v", err)
	}

	for name, testCase := range map[string]struct{ ip, want string }{
		"inside the lab range":   {"10.20.3.4", "not_required"},
		"the one allowed host":   {"192.0.2.7", "not_required"},
		"outside the lab":        {"203.0.113.9", "network_refused"},
		"unknown client address": {"", "network_refused"},
	} {
		if got := check(candidateID, testCase.ip); got != testCase.want {
			t.Errorf("%s: got %s, want %s", name, got, testCase.want)
		}
	}
	if got := check(otherID, "203.0.113.9"); got != "not_required" {
		t.Errorf("a candidate without the exam is not limited: got %s", got)
	}
	// Networks and SEB keys combine: inside the lab, the SEB check still applies.
	if err := signed(ctx, t, pool, "aether_seb_app", staffID, "seb.write", "seb.configurations", func(transaction pgx.Tx) error {
		_, err := transaction.Exec(ctx, `UPDATE seb.exam_policies SET enabled = true, accepted_keys = $2 WHERE exam_id = $1`,
			examID, []string{strings.Repeat("ab", 32)})
		return err
	}); err != nil {
		t.Fatalf("lock exam: %v", err)
	}
	if got := check(candidateID, "10.20.3.4"); got != "missing" {
		t.Errorf("inside the lab without SEB: got %s, want missing", got)
	}
}

// TestLaunchTicket proves the one-click launch credential: issued only to a candidate with an
// open assignment, spent by the first anonymous use, bound to its exam, and short-lived.
func TestLaunchTicket(t *testing.T) {
	ctx := context.Background()
	pool := startSEBDatabase(ctx, t)
	staffID, candidateID, otherID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	examID, otherExamID, assignmentID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, actor := range []string{staffID, candidateID, otherID} {
		authorize(ctx, t, pool, actor)
	}
	snapshot(ctx, t, pool, assignmentID, candidateID, examID, "active", "-1 hour", "1 hour", 1)
	if err := signed(ctx, t, pool, "aether_seb_app", staffID, "seb.write", "seb.configurations", func(transaction pgx.Tx) error {
		_, err := transaction.Exec(ctx, `
			INSERT INTO seb.exam_policies (tenant_id, exam_id, title, enabled, accepted_keys, updated_by)
			VALUES ($1, $2, 'Mid term', true, $3, $4)`, tenantID, examID, []string{strings.Repeat("ab", 32)}, staffID)
		return err
	}); err != nil {
		t.Fatalf("lock exam: %v", err)
	}

	digest := func(seed string) []byte { sum := sha256.Sum256([]byte(seed)); return sum[:] }
	issue := func(actorID, exam string, token []byte) bool {
		t.Helper()
		var issued bool
		if err := signed(ctx, t, pool, "aether_seb_app", actorID, "seb.read", "seb.sessions", func(transaction pgx.Tx) error {
			return transaction.QueryRow(ctx, `SELECT seb.issue_launch_ticket($1, $2, $3)`, tenantID, exam, token).Scan(&issued)
		}); err != nil {
			t.Fatalf("issue_launch_ticket: %v", err)
		}
		return issued
	}
	// No tenant context: the ticket is the credential, as for Safe Exam Browser's own fetch.
	consume := func(exam string, token []byte) *string {
		t.Helper()
		var title *string
		transaction, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer transaction.Rollback(ctx) //nolint:errcheck
		if _, err := transaction.Exec(ctx, `SET LOCAL ROLE aether_seb_app`); err != nil {
			t.Fatal(err)
		}
		if err := transaction.QueryRow(ctx, `SELECT seb.consume_launch_ticket($1, $2, $3)`, tenantID, exam, token).Scan(&title); err != nil {
			t.Fatalf("consume_launch_ticket: %v", err)
		}
		if err := transaction.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		return title
	}

	if issue(otherID, examID, digest("stranger")) {
		t.Error("a candidate without an assignment got a ticket")
	}
	if title := consume(examID, digest("stranger")); title != nil {
		t.Errorf("a ticket that was never issued opened %q", *title)
	}

	if !issue(candidateID, examID, digest("one")) {
		t.Fatal("assigned candidate was refused a ticket")
	}
	if title := consume(otherExamID, digest("one")); title != nil {
		t.Errorf("a ticket opened another exam's file: %q", *title)
	}
	if title := consume(examID, digest("one")); title == nil || *title != "Mid term" {
		t.Fatalf("first use = %v", title)
	}
	var window float64
	if err := pool.QueryRow(ctx, `SELECT extract(epoch FROM expires_at - consumed_at) FROM seb.launch_tickets WHERE token_hash = $1`, digest("one")).Scan(&window); err != nil {
		t.Fatal(err)
	}
	if window < 119 || window > 121 {
		t.Errorf("the re-download window after the first use is %.0f seconds, want 120", window)
	}
	// SEB downloads the link again after the exam password is typed, so the ticket works again...
	if title := consume(examID, digest("one")); title == nil || *title != "Mid term" {
		t.Errorf("the re-download SEB makes after the password prompt was refused: %v", title)
	}
	// ...until the window after the first download closes.
	if _, err := pool.Exec(ctx, `UPDATE seb.launch_tickets SET expires_at = clock_timestamp() - interval '1 second' WHERE token_hash = $1`, digest("one")); err != nil {
		t.Fatal(err)
	}
	if title := consume(examID, digest("one")); title != nil {
		t.Errorf("a ticket past its re-download window opened the file: %q", *title)
	}

	// A new ticket replaces the earlier unspent one.
	issue(candidateID, examID, digest("first"))
	issue(candidateID, examID, digest("second"))
	if title := consume(examID, digest("first")); title != nil {
		t.Errorf("a replaced ticket still worked: %q", *title)
	}
	if title := consume(examID, digest("second")); title == nil {
		t.Error("the newest ticket was refused")
	}

	// Past its sixty seconds it is refused.
	issue(candidateID, examID, digest("late"))
	if _, err := pool.Exec(ctx, `UPDATE seb.launch_tickets SET expires_at = clock_timestamp() - interval '1 second' WHERE token_hash = $1`, digest("late")); err != nil {
		t.Fatal(err)
	}
	if title := consume(examID, digest("late")); title != nil {
		t.Errorf("an expired ticket worked: %q", *title)
	}

	// The app role cannot read or write the table directly.
	if err := signed(ctx, t, pool, "aether_seb_app", candidateID, "seb.read", "seb.sessions", func(transaction pgx.Tx) error {
		_, err := transaction.Exec(ctx, `SELECT token_hash FROM seb.launch_tickets`)
		return err
	}); err == nil {
		t.Error("the app role read seb.launch_tickets directly")
	}
}
