# Bootstrap and Attempt Expiry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two Tier-1 blockers that need no external approval — a fresh deployment that cannot be reached at all (EXEC-5), and exam timers that are never enforced server-side (EXEC-4).

**Architecture:** Both are capability-less background operations, so both follow the pattern the notification retention worker already establishes: a dedicated least-privilege database role with its own connection pool, a startup self-audit proving the role has no direct table access, and all work funnelled through one `SECURITY DEFINER` function granted only to that role. No request-scoped capability exists for either operation, so `database.WithTenantTx` is deliberately not used.

**Tech Stack:** Go 1.26.0 (toolchain go1.26.5), pgx/v5, PostgreSQL with FORCE RLS, golang-migrate.

**Spec:** `docs/superpowers/specs/2026-08-20-production-readiness-roadmap.md` (sub-project D)

## Global Constraints

- Go module path for shared code is `github.com/aethercode/aethercode/libs/pkg`.
- No placeholders, stub bodies, `TODO` comments, or fake data may be committed.
- Every new SQL function is `REVOKE ALL ... FROM PUBLIC` then granted only to its dedicated role.
- Every migration ships a paired `.down.sql`. `make test-migrations` runs fresh-apply, rollback, and reapply.
- Tests are table-driven and call `t.Parallel()`.
- Commits use Conventional Commits.
- **Environment (mandatory on every Go command):**
  `export PATH="$HOME/.local/go/bin:$HOME/go/bin:$PATH"`,
  `export TMPDIR="$HOME/.cache/aethercode-tmp"`, `export GOTMPDIR="$HOME/.cache/aethercode-tmp"`.
  `/tmp` is a 437M partition the Go linker exhausts; "no space left on device" means TMPDIR is unset.

---

## Design

### Why a worker, not a request

An attempt expires because wall-clock time passed, not because anyone called an
API. There is no principal, so there is no identity assertion, so there is no
signed capability, so `WithTenantTx` cannot be used. The same is true of
bootstrap, which by definition runs before any principal exists.

The repository already solved this once, for notification retention
(`services/notification/internal/retention/`). That solution is the template:

1. A dedicated role — `aether_notification_retention_worker` — created by migration.
2. A separate pool built from its own config prefix, opened only if the worker is enabled.
3. `Ping` asserts `current_user` is exactly that role, that it is neither
   `rolsuper` nor `rolbypassrls`, that it can execute its one function, and that
   it holds **no** direct SELECT/INSERT/UPDATE/DELETE on any table in the schema.
   A worker that can reach tables directly fails readiness.
4. `ProcessOnce` runs bounded batches, each in its own transaction, stopping
   early when a batch comes back short.

Both tasks below reproduce that shape exactly. Deviating from it is the defect.

### Bootstrap: the chicken-and-egg, precisely

`users.role_assignments.granted_by_principal_id` is `NOT NULL`, and a
`super_admin` row is constrained to `scope_kind = 'platform'` with both
`tenant_id` and `scope_id` NULL. The first super_admin therefore has no granter.

Resolution: **the first assignment self-grants** — `granted_by_principal_id` is
set to the new principal's own id. This is the only assignment in the system
allowed to do so, and the bootstrap function enforces that by refusing to run at
all once any `super_admin` assignment exists.

Bootstrap spans two databases (identity owns principals, user owns role
assignments) and there is no distributed transaction between them. The command
is therefore **idempotent and re-runnable**: each half independently no-ops if
its row already exists, so a crash between the two halves is repaired by running
the command again rather than by manual surgery.

---

## Task 1: Attempt expiry worker

**Files:**
- Create: `services/submission/migrations/000017_attempt_expiry_worker.up.sql`
- Create: `services/submission/migrations/000017_attempt_expiry_worker.down.sql`
- Create: `services/submission/internal/expiry/store.go`
- Create: `services/submission/internal/expiry/runner.go`
- Create: `services/submission/internal/expiry/runtime.go`
- Test: `services/submission/internal/expiry/runner_test.go`
- Modify: `services/submission/cmd/server/main.go`
- Modify: `services/submission/README.md`

**Interfaces:**
- Consumes: nothing from other sub-projects
- Produces: `submission.expire_overdue_attempts(p_limit integer) RETURNS integer`, and the `expiry.Runner` wired into the submission server

- [ ] **Step 1: Read the template you are copying**

Run these and read the output before writing anything:

```bash
sed -n 1,80p services/notification/internal/retention/store.go
sed -n 1,80p services/notification/internal/retention/runner.go
cat services/notification/internal/retention/runtime.go
sed -n 78,110p services/notification/cmd/server/main.go
```

Your files mirror these four. The `Ping` self-audit query in `store.go` is the
part that must be reproduced most faithfully — it is the guard that proves the
worker role cannot touch tables directly.

- [ ] **Step 2: Confirm the next migration number is free**

Run: `ls services/submission/migrations/ | cut -d_ -f1 | sort -u | tail -2`

Expected: the highest is `000016` (created by the list-endpoints plan). If that
plan has not landed, use `000016` here and tell the controller, so the two plans
do not collide on a number.

- [ ] **Step 3: Write the up migration**

Create `services/submission/migrations/000017_attempt_expiry_worker.up.sql`:

```sql
-- Attempt expiry is wall-clock driven: no principal calls it, so there is no
-- identity assertion and no signed capability. The worker therefore runs as a
-- dedicated least-privilege role that can execute exactly one function and
-- reach no table directly, mirroring the notification retention worker.
SET ROLE aether_submission_owner;

CREATE FUNCTION submission.expire_overdue_attempts(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, submission, app
AS $function$
DECLARE
    expired_count integer := 0;
    attempt_row record;
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
        RAISE EXCEPTION 'expiry batch limit must be between 1 and 5000' USING ERRCODE = '22023';
    END IF;

    FOR attempt_row IN
        SELECT id, tenant_id, exam_id, exam_version_id, candidate_id, version
        FROM submission.attempts
        WHERE lifecycle_state IN ('created', 'active')
          AND submission_deadline < CURRENT_TIMESTAMP
          AND deleted_at IS NULL
        ORDER BY submission_deadline
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    LOOP
        UPDATE submission.attempts
        SET lifecycle_state = 'expired',
            completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
            version = version + 1
        WHERE id = attempt_row.id;

        -- The event is what lets SEB close the session and analytics record the
        -- outcome. Writing it in the same transaction as the state change is the
        -- whole point of the outbox.
        INSERT INTO app.outbox_events (
            event_id, aggregate_type, aggregate_id, tenant_id, event_type,
            schema_version, payload, payload_sha256, occurred_at
        )
        VALUES (
            gen_random_uuid(), 'attempt', attempt_row.id, attempt_row.tenant_id,
            'submission.attempt_expired.v1', 1,
            jsonb_build_object(
                'attempt_id', attempt_row.id,
                'tenant_id', attempt_row.tenant_id,
                'exam_id', attempt_row.exam_id,
                'exam_version_id', attempt_row.exam_version_id,
                'candidate_id', attempt_row.candidate_id,
                'expired_at', CURRENT_TIMESTAMP
            ),
            sha256(jsonb_build_object('attempt_id', attempt_row.id)::text::bytea),
            CURRENT_TIMESTAMP
        );

        expired_count := expired_count + 1;
    END LOOP;

    RETURN expired_count;
END
$function$;

CREATE INDEX attempts_expiry_scan_idx
    ON submission.attempts (submission_deadline)
    WHERE lifecycle_state IN ('created', 'active') AND deleted_at IS NULL;

REVOKE ALL ON FUNCTION submission.expire_overdue_attempts(integer) FROM PUBLIC;

RESET ROLE;
```

`FOR UPDATE SKIP LOCKED` is what makes two worker replicas safe: each claims a
disjoint set of rows rather than blocking on each other.

Before running this, verify the `app.outbox_events` column list matches — run
`sed -n '/CREATE TABLE app.outbox_events/,/^);/p' services/submission/migrations/000002_domain.up.sql`
— and adjust the INSERT to the real columns. Verify `sha256` and
`gen_random_uuid` are available (pgcrypto or Postgres 14+ builtin) with
`grep -rn "gen_random_uuid\|sha256" services/submission/migrations/*.up.sql | head`.
If the outbox table requires a UUIDv7 event id rather than `gen_random_uuid()`,
follow whatever the existing outbox INSERTs in that service do.

- [ ] **Step 4: Create the worker role**

Append to the same up migration, before `RESET ROLE`:

```sql
-- The role is created by the platform provisioner in deploy/database/platform;
-- this block only grants it what it needs, and only if it exists, so the
-- migration stays runnable against a database where the role was not
-- provisioned (development, CI migration verification).
DO $grant$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aether_submission_expiry_worker') THEN
        GRANT USAGE ON SCHEMA submission, app TO aether_submission_expiry_worker;
        GRANT EXECUTE ON FUNCTION submission.expire_overdue_attempts(integer)
            TO aether_submission_expiry_worker;
    END IF;
END
$grant$;
```

Then add the role to the development provisioner. Read
`deploy/database/platform/dev-init.sh` and follow exactly how
`aether_notification_retention_worker` is created there; add
`aether_submission_expiry_worker` the same way, with the same
`NOLOGIN`/`NOBYPASSRLS` posture.

- [ ] **Step 5: Write the down migration**

Create `services/submission/migrations/000017_attempt_expiry_worker.down.sql`:

```sql
SET ROLE aether_submission_owner;

DO $revoke$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aether_submission_expiry_worker') THEN
        REVOKE EXECUTE ON FUNCTION submission.expire_overdue_attempts(integer)
            FROM aether_submission_expiry_worker;
        REVOKE USAGE ON SCHEMA submission, app FROM aether_submission_expiry_worker;
    END IF;
END
$revoke$;

DROP INDEX IF EXISTS submission.attempts_expiry_scan_idx;
DROP FUNCTION IF EXISTS submission.expire_overdue_attempts(integer);

RESET ROLE;
```

- [ ] **Step 6: Verify the migration**

Run: `make test-migrations`
Expected: PASS — fresh apply, full rollback, reapply.

- [ ] **Step 7: Write the failing runner test**

Create `services/submission/internal/expiry/runner_test.go`. Test the runner's
batching logic against a fake store, with no database — exactly as
`services/notification/internal/retention/runner_test.go` does. Read that file
first and mirror its structure.

The behaviours that must be asserted:

```go
package expiry

import (
	"context"
	"errors"
	"log/slog"
	"io"
	"testing"
	"time"
)

type fakeStore struct {
	returns []int
	calls   []int
	err     error
}

func (store *fakeStore) Ping(context.Context) error { return nil }

func (store *fakeStore) ExpireOverdue(_ context.Context, limit int) (int, error) {
	store.calls = append(store.calls, limit)
	if store.err != nil {
		return 0, store.err
	}
	if len(store.returns) == 0 {
		return 0, nil
	}
	next := store.returns[0]
	store.returns = store.returns[1:]
	return next, nil
}

func testRuntime() Runtime {
	return Runtime{Enabled: true, BatchSize: 10, MaxBatches: 3, PollInterval: time.Minute}
}

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestProcessOnceStopsOnShortBatch(t *testing.T) {
	t.Parallel()
	store := &fakeStore{returns: []int{10, 4}}
	runner, err := NewRunner(store, testRuntime(), discardLogger())
	if err != nil {
		t.Fatalf("NewRunner() error = %v", err)
	}
	if err := runner.ProcessOnce(context.Background()); err != nil {
		t.Fatalf("ProcessOnce() error = %v", err)
	}
	if len(store.calls) != 2 {
		t.Fatalf("batches run = %d, want 2 (a short batch must end the cycle)", len(store.calls))
	}
}

func TestProcessOnceRespectsMaxBatches(t *testing.T) {
	t.Parallel()
	store := &fakeStore{returns: []int{10, 10, 10, 10, 10}}
	runner, err := NewRunner(store, testRuntime(), discardLogger())
	if err != nil {
		t.Fatalf("NewRunner() error = %v", err)
	}
	if err := runner.ProcessOnce(context.Background()); err != nil {
		t.Fatalf("ProcessOnce() error = %v", err)
	}
	if len(store.calls) != 3 {
		t.Fatalf("batches run = %d, want 3 (MaxBatches caps one cycle)", len(store.calls))
	}
}

func TestProcessOnceReturnsStoreError(t *testing.T) {
	t.Parallel()
	store := &fakeStore{err: errors.New("database unavailable")}
	runner, err := NewRunner(store, testRuntime(), discardLogger())
	if err != nil {
		t.Fatalf("NewRunner() error = %v", err)
	}
	if err := runner.ProcessOnce(context.Background()); err == nil {
		t.Fatal("ProcessOnce() error = nil, want the store error surfaced")
	}
}

func TestNewRunnerRejectsDisabledRuntime(t *testing.T) {
	t.Parallel()
	runtime := testRuntime()
	runtime.Enabled = false
	if _, err := NewRunner(&fakeStore{}, runtime, discardLogger()); err == nil {
		t.Fatal("NewRunner() accepted a disabled runtime")
	}
}
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `cd services/submission && go test ./internal/expiry/ -v`
Expected: FAIL — the package does not compile yet.

- [ ] **Step 9: Write runtime.go, store.go, and runner.go**

Mirror the three notification retention files. Specifically:

- `runtime.go`: a `Runtime` struct with `Enabled`, `BatchSize`, `MaxBatches`,
  `PollInterval`, and a `LoadRuntime(environment string) (Runtime, error)` that
  reads `SUBMISSION_EXPIRY_*` environment variables and validates every bound.
  Copy the validation strictness from the retention equivalent — reject
  non-positive batch sizes and intervals rather than defaulting them.
- `store.go`: `const expiryRole = "aether_submission_expiry_worker"`, a `Store`
  over a `*pgxpool.Pool`, a `Ping` reproducing the four-part self-audit against
  `'submission.expire_overdue_attempts(integer)'` and the `submission` schema,
  and `ExpireOverdue(ctx, limit) (int, error)` calling the function.
- `runner.go`: `Purger`-shaped interface named `Expirer` with `Ping` and
  `ExpireOverdue`, plus `NewRunner`, `ProcessOnce`, `Run`, and `Ready` with the
  same `lastGood` staleness tracking.

- [ ] **Step 10: Run the tests to verify they pass**

Run: `cd services/submission && go test ./internal/expiry/ -v`
Expected: PASS, all four.

- [ ] **Step 11: Wire the worker into the server**

In `services/submission/cmd/server/main.go`, follow the notification server's
conditional-startup shape: load the runtime, and only if enabled, load
`config.LoadDatabase("SUBMISSION_EXPIRY")`, open a second pool, construct the
store and runner, add the runner to readiness, and start `Run` in a goroutine
tied to the server context. The service must start normally with the worker
disabled.

- [ ] **Step 12: Verify the whole service builds and passes**

```bash
cd services/submission && go test ./...
cd /home/shreesh/Documents/AlgoQX && make build && make vet && make fmt-check
```

Expected: all pass.

- [ ] **Step 13: Document and commit**

Add a section to `services/submission/README.md` covering the worker: what it
does, its `SUBMISSION_EXPIRY_*` configuration, its dedicated role, and the fact
that it emits `submission.attempt_expired.v1`. Then:

```bash
git add services/submission/ deploy/database/platform/
git commit -m "feat: expire overdue attempts with a least-privilege worker"
```

---

## Task 2: Platform bootstrap

**Files:**
- Create: `services/identity/migrations/000012_platform_bootstrap.{up,down}.sql`
- Create: `services/user/migrations/000022_platform_bootstrap.{up,down}.sql`
- Create: `libs/pkg/cmd/bootstrap/main.go`
- Test: `libs/pkg/cmd/bootstrap/main_test.go`
- Modify: `Makefile`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing
- Produces: `make bootstrap EMAIL=... NAME=...`, `identity.bootstrap_first_principal(...)`, `users.bootstrap_first_superadmin(...)`

- [ ] **Step 1: Confirm the next migration numbers**

Run: `ls services/identity/migrations/ services/user/migrations/ | cut -d_ -f1 | sort -u | tail -3`

Identity's highest is `000011`; user's is `000021` if the list-endpoints plan has
landed, `000019` otherwise. Use the next free number in each and keep the file
names consistent with what you choose.

- [ ] **Step 2: Write the identity bootstrap migration**

Create `services/identity/migrations/000012_platform_bootstrap.up.sql`:

```sql
-- Day-zero entry point. Every principal-creating path requires an authenticated
-- caller, so a fresh deployment has no way in. This function is the single
-- exception, and it closes itself permanently: once any principal exists with a
-- verified email, it refuses.
SET ROLE aether_identity_owner;

CREATE FUNCTION identity.bootstrap_first_principal(
    p_principal_id uuid,
    p_email text,
    p_display_name text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, identity
AS $function$
DECLARE
    existing_id uuid;
BEGIN
    -- Idempotent: bootstrap spans two databases with no distributed
    -- transaction, so re-running after a partial failure must succeed.
    SELECT id INTO existing_id
    FROM identity.principals
    WHERE lower(email) = lower(btrim(p_email)) AND deleted_at IS NULL;
    IF existing_id IS NOT NULL THEN
        RETURN existing_id;
    END IF;

    IF EXISTS (SELECT 1 FROM identity.principals WHERE deleted_at IS NULL) THEN
        RAISE EXCEPTION 'platform already has principals; bootstrap is closed'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO identity.principals (id, email, display_name, status, email_verified_at)
    VALUES (p_principal_id, btrim(p_email), btrim(p_display_name), 'active', CURRENT_TIMESTAMP);

    RETURN p_principal_id;
END
$function$;

REVOKE ALL ON FUNCTION identity.bootstrap_first_principal(uuid, text, text) FROM PUBLIC;

RESET ROLE;
```

The bootstrapped principal has **no password credential**. That is deliberate:
the operator completes setup through the existing password-reset flow, so no
initial secret is ever written to a migration, a log, or a terminal. State this
in the README.

- [ ] **Step 3: Write the identity down migration**

```sql
SET ROLE aether_identity_owner;

DROP FUNCTION IF EXISTS identity.bootstrap_first_principal(uuid, text, text);

RESET ROLE;
```

- [ ] **Step 4: Write the user bootstrap migration**

Create `services/user/migrations/000022_platform_bootstrap.up.sql`:

```sql
-- The first super_admin has no granter: role_assignments.granted_by_principal_id
-- is NOT NULL, and no principal exists yet who could have granted it. This
-- assignment therefore self-grants, and it is the only one in the system
-- permitted to. The function refuses once any super_admin exists.
SET ROLE aether_user_owner;

CREATE FUNCTION users.bootstrap_first_superadmin(
    p_assignment_id uuid,
    p_principal_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, users
AS $function$
DECLARE
    existing_id uuid;
BEGIN
    SELECT id INTO existing_id
    FROM users.role_assignments
    WHERE principal_id = p_principal_id
      AND role_name = 'super_admin'
      AND scope_kind = 'platform'
      AND status = 'active'
      AND deleted_at IS NULL;
    IF existing_id IS NOT NULL THEN
        RETURN existing_id;
    END IF;

    IF EXISTS (
        SELECT 1 FROM users.role_assignments
        WHERE role_name = 'super_admin' AND status = 'active' AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'platform already has a super_admin; bootstrap is closed'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO users.role_assignments (
        id, principal_id, role_name, scope_kind, tenant_id, scope_id,
        status, granted_by_principal_id
    )
    VALUES (
        p_assignment_id, p_principal_id, 'super_admin', 'platform', NULL, NULL,
        'active', p_principal_id
    );

    RETURN p_assignment_id;
END
$function$;

REVOKE ALL ON FUNCTION users.bootstrap_first_superadmin(uuid, uuid) FROM PUBLIC;

RESET ROLE;
```

Verify before running that `users.role_assignments` has `deleted_at` — it gained
it in `000017_soft_delete_schema.up.sql` — and that inserting a row does not trip
an authorization-revision trigger that needs a signed context. Check with
`grep -n "TRIGGER" services/user/migrations/000002_user_domain.up.sql | head`.
If a trigger requires a context, the function must set it or the insert must go
through whatever path the trigger expects; do not disable the trigger.

- [ ] **Step 5: Write the user down migration**

```sql
SET ROLE aether_user_owner;

DROP FUNCTION IF EXISTS users.bootstrap_first_superadmin(uuid, uuid);

RESET ROLE;
```

- [ ] **Step 6: Verify both migrations**

Run: `make test-migrations`
Expected: PASS.

- [ ] **Step 7: Write the failing CLI test**

Create `libs/pkg/cmd/bootstrap/main_test.go` testing the pure argument-validation
surface with no database:

```go
package main

import "testing"

func TestValidateArgumentsRejectsBadInput(t *testing.T) {
	t.Parallel()
	testCases := []struct {
		name      string
		email     string
		display   string
		wantError bool
	}{
		{name: "valid", email: "admin@college.edu", display: "Platform Admin"},
		{name: "empty email", email: "", display: "Platform Admin", wantError: true},
		{name: "no at sign", email: "admincollege.edu", display: "Admin", wantError: true},
		{name: "at sign first", email: "@college.edu", display: "Admin", wantError: true},
		{name: "empty display name", email: "admin@college.edu", display: "", wantError: true},
		{name: "whitespace display name", email: "admin@college.edu", display: "   ", wantError: true},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			err := validateArguments(testCase.email, testCase.display)
			if (err != nil) != testCase.wantError {
				t.Fatalf("validateArguments(%q, %q) error = %v, wantError = %t",
					testCase.email, testCase.display, err, testCase.wantError)
			}
		})
	}
}
```

The email rules mirror the `identity.principals` CHECK constraint: trimmed,
3..320 characters, and `position('@' IN email) > 1`.

- [ ] **Step 8: Run to verify failure**

Run: `cd libs/pkg && go test ./cmd/bootstrap/ -v`
Expected: FAIL — package does not exist.

- [ ] **Step 9: Write the CLI**

Create `libs/pkg/cmd/bootstrap/main.go`. It takes `--identity-database-url`,
`--user-database-url`, `--email`, and `--display-name`; generates one UUIDv7 for
the principal and one for the assignment using `database.NewUUIDv7`; calls
`identity.bootstrap_first_principal` on the first connection and
`users.bootstrap_first_superadmin` on the second; and prints the resulting
principal id.

Model its structure on the existing `libs/pkg/cmd/migrate/main.go` — read it
first for the flag-parsing and connection conventions this repo uses.

It must print, on success, that the account has no password and must be
activated through the password-reset flow. It must never print or accept a
password.

- [ ] **Step 10: Run the tests**

Run: `cd libs/pkg && go test ./cmd/bootstrap/ -v`
Expected: PASS.

- [ ] **Step 11: Add the make target**

In `Makefile`, add `bootstrap` to `.PHONY` and the help line, then:

```make
bootstrap:
	@test -n "$(EMAIL)" || { echo "EMAIL is required"; exit 1; }
	@test -n "$(NAME)" || { echo "NAME is required"; exit 1; }
	@test -n "$$IDENTITY_DATABASE_URL" || { echo "IDENTITY_DATABASE_URL is required"; exit 1; }
	@test -n "$$USER_DATABASE_URL" || { echo "USER_DATABASE_URL is required"; exit 1; }
	@(cd libs/pkg && go run ./cmd/bootstrap \
		--identity-database-url "$$IDENTITY_DATABASE_URL" \
		--user-database-url "$$USER_DATABASE_URL" \
		--email "$(EMAIL)" --display-name "$(NAME)")
```

- [ ] **Step 12: Full verification and commit**

```bash
make build && make test && make vet && make fmt-check && make test-migrations
git add services/identity/migrations/ services/user/migrations/ libs/pkg/cmd/bootstrap/ Makefile README.md
git commit -m "feat: add day-zero platform bootstrap command"
```

Document the command in the root `README.md` under a "First run" heading,
including that the created account has no password and is activated through
password reset.

---

## Completion checklist

- [ ] `submission.expire_overdue_attempts` transitions overdue attempts and emits `submission.attempt_expired.v1`
- [ ] The expiry worker runs as a role with no direct table access, proven by its own readiness check
- [ ] Two worker replicas cannot double-process a row (`FOR UPDATE SKIP LOCKED`)
- [ ] `make bootstrap` creates the first principal and self-granted super_admin, and is safe to re-run
- [ ] Both bootstrap functions refuse once the platform is initialised
- [ ] No password is ever written, printed, or accepted by the bootstrap path
- [ ] `make build`, `test`, `vet`, `fmt-check`, `test-migrations` all pass
- [ ] Both service READMEs document the new surface

## Notes for the executor

**On copying the retention worker.** Reproduce its `Ping` self-audit faithfully.
It is not boilerplate: it is the check that catches a misconfigured deployment
handing the worker a superuser connection string, and it is why the worker fails
readiness rather than silently running with too much privilege.

**On the outbox insert.** The state change and the event must be in the same
transaction. If you find yourself writing the event from Go after the function
returns, stop — that reintroduces the dual-write problem the outbox exists to
eliminate.

**On bootstrap idempotency.** Two databases, no distributed transaction. Every
branch must be safe to re-enter. Test that re-running after a simulated failure
between the halves converges rather than erroring.
