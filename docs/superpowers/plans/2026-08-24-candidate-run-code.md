# Candidate Run-Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a candidate run their code against a question's sample test cases during a live exam attempt — HackerRank-style: a "Run" action separate from formal "Submit," per-test-case pass/fail with actual-vs-expected output, and a visible run history for the current item — without ever touching the hidden grading test set or the permanent grading record.

**Architecture:** Sample test bundles get pinned onto exam items at authoring time, mirroring the existing hidden-bundle pattern exactly. A new `submission.code_runs` table and three new endpoints (start a run, poll its status, list recent runs) dispatch through the same judge gRPC path formal grading already uses, just pointed at the sample bundle. A purge worker (mirroring the existing attempt-expiry-worker pattern) reclaims run history after grading completes.

**Tech Stack:** Go 1.26.7, pgx/v5, existing `libs/pkg/ratelimit`/`libs/pkg/pagination`/`libs/pkg/storage`/`libs/pkg/kms`.

**Spec:** `docs/superpowers/specs/2026-08-24-judge0-execution-and-run-code-design.md` (Phase D)

## Global Constraints

- Go module path for shared code is `github.com/aethercode/aethercode/libs/pkg`.
- No placeholders, stub bodies, `TODO` comments, or fake data may be committed.
- Every new SQL function is `REVOKE ALL ... FROM PUBLIC` then granted only to its intended role.
- Every migration ships a paired `.down.sql`. `make test-migrations` verifies fresh-apply, rollback, reapply.
- Tests are table-driven and call `t.Parallel()`.
- Commits use Conventional Commits.
- A run must NEVER touch `evaluation_requests`, `judge_receipts`, or `score_summaries` — those are the permanent grading record and this feature must be structurally incapable of writing to them.
- **Environment (mandatory on every Go command):**
  `export PATH="$HOME/.local/go/bin:$HOME/go/bin:$PATH"`,
  `export TMPDIR="$HOME/.cache/aethercode-tmp"`, `export GOTMPDIR="$HOME/.cache/aethercode-tmp"`.

---

## Design

### Depends on the other three plans in this series

This plan assumes `2026-08-24-judge0-real-adapter.md`, `2026-08-24-judge-testcase-fanout.md`, and `2026-08-24-judge-per-unit-results.md` are already implemented — it needs real execution, per-test-case fan-out, and per-unit result surfacing all working to produce a meaningful per-sample-test result. It can technically be built and tested against the stub engine (results will just be fake), but do not present it as functionally complete until the other three plans have landed.

### REQUIRED: close the decrypt-before-dispatch gap as part of this plan's Task 4

The fan-out plan's final review (2026-08-25) surfaced a real, currently-latent gap that this plan's Task 4 makes reachable for the first time: `DispatchStoreAdapter.FetchQueuedJob` (`services/judge/internal/adapters/repo/store_adapter.go`) currently passes `source_ciphertext_ref`/`test_case_ciphertext_ref` straight through to the evaluation engine as literal `SourceCode`/`Stdin` — there is no decrypt-and-fetch step anywhere between object storage and the engine. Today this is harmless because no job can ever be admitted (the evaluation bundle's KMS key reference has no real source through any RPC caller, so `Submit` always fails before dispatch). Task 4 of THIS plan is what finally supplies a real, reachable dispatch path (candidate run-code → real `SubmitExecution` call with a real bundle key reference) — the moment that lands, every dispatched unit will silently ship an undecrypted object key to Judge0 as if it were source code, producing a compile-error verdict for every run.

Task 4 must add the missing decrypt-and-fetch step (fetch `source_ciphertext_ref`/`test_case_ciphertext_ref` from storage, decrypt with the per-unit `encryption_key_reference` the fan-out plan's migration 000006 added, before handing plaintext to the engine) as part of wiring the real run-dispatch path — do not treat this as already solved by an earlier plan. This is a new, required step in Task 4's scope, not an optional follow-up.

### Submission encrypts and uploads source itself — correcting an earlier assumption

`AppendAnswerRevision` (the existing formal-answer-save path) does **not** perform any encryption or upload — it accepts an already-encrypted, already-uploaded `source_object_key`/`source_checksum`/`encryption_key_reference` triplet as plain strings in the request body. There is no `PresignPut` anywhere in `libs/pkg/storage`, so there is genuinely no client-side upload mechanism built anywhere in this backend today — the existing formal-submission flow implicitly depends on something outside this codebase to handle upload, which is a separate, pre-existing gap this plan does not fix.

This plan sidesteps that gap entirely: the run-code endpoint takes **raw source in the request body** and the submission service encrypts + uploads it itself, server-side, using the existing `storage.Object`/`kms.KeyManager` ports — the same two ports, used in the same fetch-then-decrypt shape as question-bank's `GetBundle`, just inverted (encrypt-then-store). Submission's `Service` struct does not currently hold `storage`/`kms` fields (confirm this is still true when this plan executes — if a prior change added them, use what's there); Task 3 adds them if absent.

### Sample-bundle pinning mirrors the hidden-bundle pattern exactly

`assessment.exam_items.evaluation_bundle_object_key`/`evaluation_bundle_checksum` were added via `ALTER TABLE` in a prior migration (000006), as plain caller-supplied strings validated with an object-key-shape regex and a checksum regex — assessment never resolves or validates these against question-bank. This plan's `sample_bundle_object_key`/`sample_bundle_checksum` columns follow the identical shape, nullable (not every question has sample tests), supplied by the same caller.

---

## Task 1: Sample bundle pinning on exam items

**Files:**
- Create: `services/assessment/migrations/<NNNN>_sample_bundle_pinning.up.sql` / `.down.sql`
- Modify: `services/assessment/internal/app/service.go`
- Modify: `services/assessment/internal/adapters/repo/postgres.go`
- Modify: `services/assessment/internal/adapters/http/handler.go`
- Test: `services/assessment/internal/app/service_test.go`, `services/assessment/internal/adapters/http/handler_test.go`

**Interfaces:**
- Produces: `app.AddExamItem.SampleBundleObjectKey`/`SampleBundleChecksum` (both optional), persisted on `assessment.exam_items`; consumed by Task 4 (run dispatch needs to read these back)

- [ ] **Step 1: Confirm the next free assessment migration number and re-read the exact hidden-bundle column definition**

```bash
ls services/assessment/migrations/ | grep -oE '^[0-9]+' | sort -u | tail -3
grep -n "evaluation_bundle_object_key\|evaluation_bundle_checksum" services/assessment/migrations/000006_candidate_assignment_snapshot.up.sql
```

- [ ] **Step 2: Write the migration**

Create `services/assessment/migrations/<NNNN>_sample_bundle_pinning.up.sql`, mirroring the exact CHECK constraints found in Step 1:

```sql
SET ROLE aether_assessment_owner;

ALTER TABLE assessment.exam_items
    ADD COLUMN sample_bundle_object_key text
        CHECK (
            sample_bundle_object_key IS NULL OR (
                length(sample_bundle_object_key) BETWEEN 1 AND 1024
                AND sample_bundle_object_key ~ '^[A-Za-z0-9][A-Za-z0-9._/=@+-]*$'
                AND sample_bundle_object_key !~ '(^|/)\.\.(/|$)'
            )
        ),
    ADD COLUMN sample_bundle_checksum char(64)
        CHECK (sample_bundle_checksum IS NULL OR sample_bundle_checksum ~* '^[0-9a-f]{64}$'),
    ADD CONSTRAINT sample_bundle_pair_complete CHECK (
        (sample_bundle_object_key IS NULL) = (sample_bundle_checksum IS NULL)
    );

RESET ROLE;
```

Write the paired `.down.sql` (`ALTER TABLE assessment.exam_items DROP CONSTRAINT sample_bundle_pair_complete, DROP COLUMN sample_bundle_object_key, DROP COLUMN sample_bundle_checksum;` inside the same `SET ROLE`/`RESET ROLE` wrapper).

- [ ] **Step 3: Run to verify the migration**

Run: `make test-migrations`
Expected: PASS.

- [ ] **Step 4: Write the failing app-layer test**

Read `services/assessment/internal/app/service.go`'s `AddExamItem` method and its command struct in full first. Add a test to `service_test.go` asserting `AddExamItem` accepts a command with `SampleBundleObjectKey`/`SampleBundleChecksum` both empty (valid — sample tests are optional) and both populated (valid), and rejects one-populated-one-empty (matching the migration's pair-completeness constraint — validate this at the app layer too, not just the database, so the error is a clean `400` not a raw constraint violation).

- [ ] **Step 5: Run to verify it fails**

Run: `cd services/assessment && go test ./internal/app/... -run TestAddExamItem -v`
Expected: FAIL — new fields don't exist on the command struct.

- [ ] **Step 6: Extend AddExamItem**

In `services/assessment/internal/app/service.go`: add `SampleBundleObjectKey string` and `SampleBundleChecksum string` to the `AddExamItem` command struct. In the method body, add validation mirroring the existing `EvaluationBundleObjectKey`/`EvaluationBundleChecksum` validation calls (`validObjectKey(...)`, checksum-pattern match) but only when non-empty, plus the pair-completeness check: `(command.SampleBundleObjectKey == "") != (command.SampleBundleChecksum == "")` → invalid.

In `services/assessment/internal/adapters/repo/postgres.go`'s `AddExamItem` repo method: add the two new columns to the `INSERT` statement and its parameter list.

In `services/assessment/internal/adapters/http/handler.go`: add `SampleBundleObjectKey`/`SampleBundleChecksum` (JSON tags `sample_bundle_object_key`/`sample_bundle_checksum`) to `addExamItemRequest`, and thread them into the `app.AddExamItem{...}` construction in the `addExamItem` handler.

- [ ] **Step 7: Run to verify tests pass**

Run: `cd services/assessment && go test ./... -v`
Expected: PASS.

- [ ] **Step 8: Full verification and commit**

```bash
cd /home/shreesh/Documents/AlgoQX && make build && make test && make vet && make fmt-check && make lint && make test-migrations
git add services/assessment/
git commit -m "feat: pin sample test bundles on exam items"
```

---

## Task 2: code_runs table

**Files:**
- Create: `services/submission/migrations/<NNNN>_code_runs.up.sql` / `.down.sql`

**Interfaces:**
- Produces: `submission.code_runs` table, consumed by Tasks 3-5

- [ ] **Step 1: Confirm the next free submission migration number**

Run: `ls services/submission/migrations/ | grep -oE '^[0-9]+' | sort -u | tail -3`

(Note: an earlier plan in this series, `2026-08-24-judge-per-unit-results.md`, also claims a migration number in this same sequence for `judge_receipt_units` — if that plan has already landed by the time this task runs, re-check the highest number fresh rather than assuming a fixed value; if it hasn't landed yet, this task's number and that plan's number must not collide, so coordinate by re-checking `ls` immediately before writing the filename.)

- [ ] **Step 2: Write the migration**

Create `services/submission/migrations/<NNNN>_code_runs.up.sql`:

```sql
SET ROLE aether_submission_owner;

CREATE TABLE submission.code_runs (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    exam_item_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    language_id text NOT NULL CHECK (length(language_id) BETWEEN 1 AND 80),
    source_object_key text NOT NULL CHECK (length(source_object_key) > 0),
    source_checksum char(64) NOT NULL CHECK (source_checksum ~* '^[0-9a-f]{64}$'),
    encryption_key_reference text NOT NULL CHECK (length(encryption_key_reference) > 0),
    judge_job_id uuid,
    lifecycle_state text NOT NULL DEFAULT 'queued'
        CHECK (lifecycle_state IN ('queued', 'dispatched', 'completed', 'failed', 'cancelled')),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamptz,
    purge_after timestamptz NOT NULL,
    CHECK (
        lifecycle_state NOT IN ('completed', 'failed', 'cancelled')
        OR completed_at IS NOT NULL
    ),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, attempt_id)
        REFERENCES submission.attempts (tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE submission.code_run_units (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    code_run_id uuid NOT NULL,
    unit_number integer NOT NULL CHECK (unit_number >= 0),
    verdict text NOT NULL
        CHECK (verdict IN ('accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded', 'runtime_error', 'compile_error', 'internal_error', 'cancelled')),
    stdout text,
    stderr text,
    expected_output text,
    execution_time_ms integer CHECK (execution_time_ms IS NULL OR execution_time_ms >= 0),
    memory_kib integer CHECK (memory_kib IS NULL OR memory_kib >= 0),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code_run_id, unit_number),
    FOREIGN KEY (tenant_id, code_run_id)
        REFERENCES submission.code_runs (tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX code_runs_attempt_item_idx
    ON submission.code_runs (tenant_id, attempt_id, exam_item_id, created_at DESC);
CREATE INDEX code_runs_purge_idx
    ON submission.code_runs (purge_after)
    WHERE lifecycle_state IN ('completed', 'failed', 'cancelled');

ALTER TABLE submission.code_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission.code_run_units ENABLE ROW LEVEL SECURITY;

-- Mirror this service's existing RLS policy shape for a candidate-owned,
-- attempt-scoped table exactly. Read the RLS policies on
-- submission.answer_revisions first (grep "answer_revisions" in
-- services/submission/migrations/*.up.sql) and reproduce the same
-- current_context_allows-style USING/WITH CHECK clauses here, substituting
-- the table name — do not invent a different authorization shape.

REVOKE ALL ON TABLE submission.code_runs, submission.code_run_units FROM PUBLIC;
GRANT SELECT, INSERT ON submission.code_runs TO aether_submission_app;
GRANT SELECT, INSERT ON submission.code_run_units TO aether_submission_app;

RESET ROLE;
```

Note: `code_run_units.stdout`/`stderr`/`expected_output` are stored as plain (unencrypted) columns here, unlike `judge_receipt_units` from the per-unit-results plan, which deliberately excludes raw content. This is intentional and safe specifically for run-code: sample-test content is never confidential (the candidate can already see the sample test's expected output from the question itself), unlike hidden-test content. Do not apply this same choice to anything hidden-test-related.

Write the paired `.down.sql`.

- [ ] **Step 3: Run to verify the migration**

Run: `make test-migrations`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add services/submission/migrations/
git commit -m "feat: add code_runs schema for candidate sample-test runs"
```

---

## Task 3: Wire storage/KMS into submission's Service, add the rate limiter

**Files:**
- Modify: `services/submission/internal/app/service.go`
- Modify: `services/submission/cmd/server/main.go`
- Modify: `services/submission/internal/adapters/http/handler.go`

**Interfaces:**
- Consumes: `storage.Object`, `kms.KeyManager` (existing ports); `ratelimit.New`/`ratelimit.Limiter` (existing, from Wave 1)
- Produces: `app.Service.storage`/`app.Service.kms` fields; `Handler.runCodeLimiter *ratelimit.Limiter`

- [ ] **Step 1: Confirm current state**

```bash
grep -n "storage\.\|kms\." services/submission/internal/app/service.go
grep -n "storage\.\|kms\." services/submission/cmd/server/main.go
```

If storage/KMS are already wired (a later change may have added them for an unrelated reason), skip straight to adding the rate limiter; otherwise do both in this task.

- [ ] **Step 2: Add storage/KMS to Service, mirroring question-bank's constructor exactly**

Read `services/question-bank/internal/app/service.go`'s `Service` struct and `NewService` constructor in full, and `services/question-bank/cmd/server/main.go`'s construction of the storage/KMS adapters. Reproduce the identical pattern in `services/submission/internal/app/service.go` (`Service.storage storage.Object`, `Service.kms kms.KeyManager` fields, added as optional constructor parameters so existing callers that don't need them still compile — check how `NewService` is currently called across `services/submission` to decide whether to add these as required params with all call sites updated, or as a follow-up `WithStorage`/`WithKMS` option, matching whatever founding pattern minimizes disruption to this file) and in `services/submission/cmd/server/main.go` (construct the same MinIO/local-KMS adapters question-bank's `main.go` constructs, using the same env-var-driven config pattern).

- [ ] **Step 3: Add the run-code rate limiter**

Read `services/submission/internal/adapters/http/handler.go`'s `Handler` struct, `NewHandler`, and `startAttempt`'s limiter guard in full (already quoted in this plan's context — re-read fresh in case the file has changed). Add `runCodeLimiter *ratelimit.Limiter` as a new `Handler` field and `NewHandler` parameter (nil-means-disabled, matching `startAttemptLimiter`'s convention exactly), and a `const retryAfterRunCode = "60"` (a much shorter window than attempt creation — this is meant to allow frequent iterative runs, just bound abuse, not create per-hour friction).

In `services/submission/cmd/server/main.go`, construct it the same way `startAttemptLimiter` is constructed, reading new `SUBMISSION_RUN_CODE_BURST`/`SUBMISSION_RUN_CODE_RATE` env vars (add these to `services/submission/internal/config`, following whatever loader already validates `StartAttemptBurst`/`StartAttemptRate`). Size the defaults generously — this is meant to support rapid iteration (a candidate might reasonably run code 10+ times while debugging one item), not throttle normal use; something like burst 30, rate 300/hour per candidate is a reasonable starting point, stated with that reasoning in the README per this plan's Task 5.

- [ ] **Step 4: Build and verify**

```bash
cd services/submission && go build ./... && go test ./... -v
cd /home/shreesh/Documents/AlgoQX && make build && make test && make vet && make fmt-check
```

- [ ] **Step 5: Commit**

```bash
git add services/submission/
git commit -m "feat: wire object storage, KMS, and a rate limiter for candidate code runs"
```

---

## Task 4: The run-dispatch endpoint

**Files:**
- Modify: `services/submission/internal/app/service.go`
- Modify: `services/submission/internal/adapters/repo/postgres.go`
- Modify: `services/submission/internal/adapters/http/handler.go`
- Test: corresponding files

**Interfaces:**
- Consumes: `sample_bundle_object_key`/`sample_bundle_checksum` from Task 1's `assessment.exam_items` (submission needs read access to this — check whether submission already has a local projection of exam_items, e.g. `submission.assignment_item_projections` seen earlier in this codebase's schema, or whether it needs a new read path to assessment; investigate before implementing), `storage`/`kms` from Task 3, judge's gRPC `SubmitExecution` client
- Produces: `POST /v1/tenants/{tenant_id}/attempts/{attempt_id}/items/{exam_item_id}/run`

- [ ] **Step 1: Find how submission already dispatches to judge for formal grading**

Formal grading already reaches judge somehow (`evaluation_requests` get dispatched, judge produces `judge_receipts`). Find the existing gRPC client call:

```bash
grep -rln "judgev1.NewJudgeServiceClient\|SubmitExecution(" services/submission/internal/
```

Read that call site in full — this plan's run-dispatch must reuse the exact same gRPC client construction and call shape, just with different bundle/fairness-key values, not build a second parallel client.

- [ ] **Step 2: Find how submission reads exam-item data (specifically, the new sample bundle fields)**

```bash
grep -n "assignment_item_projections\|exam_item" services/submission/internal/adapters/repo/postgres.go | head -20
```

Confirm whether `submission.assignment_item_projections` (seen in this service's migrations) already mirrors exam-item fields via an event-driven projection (the platform's established cross-service data pattern — check for an existing projection worker consuming `assessment.exam_item.*` events) and, if so, extend that projection to also carry `sample_bundle_object_key`/`sample_bundle_checksum`. If no such projection exists for exam items today, this step needs to establish how submission learns about a sample bundle's existence — do not invent a live cross-service HTTP call to assessment as a shortcut; this platform consistently uses event-driven projections for cross-service reads (see `services/tenant`'s authorization-grant-snapshot pattern, `services/analytics`'s exam_item_projections table), so extend whatever existing projection mechanism applies here.

- [ ] **Step 3: Write the failing app-layer test**

Add to `services/submission/internal/app/service_test.go`: a test for a new `RunCode` command/method covering: valid request dispatches (fake judge client, fake storage, fake KMS — check existing test file for the established fake/mock style and match it); missing sample bundle on the target item returns a specific error mappable to `409`; attempt not in `active` lifecycle state is rejected.

- [ ] **Step 4: Run to verify it fails**

Run: `cd services/submission && go test ./internal/app/... -run TestRunCode -v`
Expected: FAIL — `RunCode` undefined.

- [ ] **Step 5: Implement `Service.RunCode`**

```go
// RunCode struct and its Validate/Service.RunCode method: accepts raw
// source, encrypts + uploads it (storage.Put + kms.Encrypt, mirroring
// question-bank's GetBundle in reverse), inserts a submission.code_runs row
// via WithTenantTx, dispatches to judge's SubmitExecution using the item's
// sample_bundle_object_key (never evaluation_bundle_object_key), and returns
// the created run's ID. If the target item has no sample bundle, return a
// distinct error the handler maps to 409, not a generic failure.
```

Write the actual method (not a comment) following the exact structure `AppendAnswerRevision` already establishes for normalize-then-validate-then-`WithTenantTx` — the source-encryption step happens *before* the transaction (storage/KMS calls should not hold a database transaction open across a network round trip), and the dispatch-to-judge gRPC call happens *after* the transaction commits (so a run row always exists in the database before a job is ever dispatched, making crash-recovery/reconciliation possible the same way this platform's other async flows already handle it — check `services/submission/internal/expiry` or the judge dispatcher's own "insert then dispatch" ordering for the established pattern in this codebase).

- [ ] **Step 6: Repo method**

Add `InsertCodeRun`/whatever repo method persists the `code_runs` row, following `AppendAnswerRevision`'s repo-method shape exactly (parameterized INSERT, tenant-scoped).

- [ ] **Step 7: HTTP handler**

Add `runCode` handler and route `POST /v1/tenants/{tenant_id}/attempts/{attempt_id}/items/{exam_item_id}/run` to `services/submission/internal/adapters/http/handler.go`, following `startAttempt`'s exact shape: parse path values, apply `handler.runCodeLimiter` guard (429 + `Retry-After: retryAfterRunCode` on rejection, matching `startAttempt`'s exact response shape), `AuthorizeHTTP` with action `"write"` resource `"code_runs"`, decode `{language_id, source}` from the body, call `handler.service.RunCode(...)`, return `202 Accepted` with `{run_id}` (not `201 Created` — a run is dispatched, not yet a completed resource; `202` is this platform's existing convention for "accepted, not yet done" per how attempts vs. submissions are handled elsewhere — verify this convention against an existing async endpoint in this codebase before committing to `202` vs `201`, since this is worth getting consistent with established practice rather than guessing).

- [ ] **Step 8: Run to verify tests pass**

Run: `cd services/submission && go test ./... -v`
Expected: PASS.

- [ ] **Step 9: Full verification and commit**

```bash
cd /home/shreesh/Documents/AlgoQX && make build && make test && make vet && make fmt-check && make lint
git add services/submission/
git commit -m "feat: add candidate run-code dispatch endpoint"
```

---

## Task 5: Run status and run history endpoints

**Files:**
- Modify: `services/submission/internal/app/service.go`
- Modify: `services/submission/internal/adapters/http/handler.go`
- Modify: `services/submission/README.md`
- Test: corresponding files

**Interfaces:**
- Consumes: `submission.code_runs`/`submission.code_run_units` from Task 2, populated by Task 4's dispatch and (once judge's completion pipeline delivers a result) an ingestion path this task also needs to add — a run's completion arrives the same way a formal submission's does (via judge's completion event stream), so this task extends whatever consumes `judge.completed.v1` outbox events (or the equivalent for runs — check whether runs and formal evaluations share one completion-ingestion path keyed by `judge_job_id`, or need their own; the cleanest design is one shared ingestion path that looks up whether a `judge_job_id` belongs to an `evaluation_request` or a `code_run` and updates the right table — investigate `services/submission/internal/adapters/judgecompletion/worker.go` before deciding)
- Produces: `GET /v1/tenants/{tenant_id}/attempts/{attempt_id}/runs/{run_id}`, `GET /v1/tenants/{tenant_id}/attempts/{attempt_id}/items/{exam_item_id}/runs`

- [ ] **Step 1: Investigate the completion-ingestion sharing question**

Read `services/submission/internal/adapters/judgecompletion/worker.go` in full. Determine whether extending it to also handle `code_runs` completions (by looking up `judge_job_id` in both `evaluation_requests` and `code_runs` and updating whichever matches) is straightforward, or whether a separate lightweight consumer for runs is cleaner given this codebase's existing separation of concerns. Make the call and document it in your task report — this is a real design decision, not a mechanical step.

- [ ] **Step 2: Write the failing tests**

Add tests for: `GetCodeRun` (returns full per-unit detail — sample-test content is never redacted, per this plan's design section) and `ListCodeRuns` (cursor-paginated, scoped to one exam item, most recent first).

- [ ] **Step 3: Implement the completion-ingestion extension**

Based on Step 1's decision, wire `code_run_units` population from the same `Completion.unit_results` (proto field from the per-unit-results plan) that formal grading now receives.

- [ ] **Step 4: Implement `GetCodeRun`/`ListCodeRuns` app methods and repo methods**

`ListCodeRuns` follows `listAttempts`'s exact cursor-pagination shape: `pagination.ParseLimit`, `pagination.Parse` for the cursor, ordered by `created_at DESC`.

- [ ] **Step 5: HTTP handlers**

`GET .../runs/{run_id}` — mirrors `getAttempt`'s shape (parse path values, `AuthorizeHTTP` read, call service, `200` with the full run including per-unit results). `GET .../items/{exam_item_id}/runs` — mirrors `listAttempts`'s shape exactly (limit/cursor parsing, `AuthorizeSelfHTTP`, `200` with the paginated envelope).

- [ ] **Step 6: Run tests**

Run: `cd services/submission && go test ./... -v`
Expected: PASS.

- [ ] **Step 7: Document and commit**

Update `services/submission/README.md` with the three new endpoints, the rate-limit defaults and their reasoning, and a note that run results are never redacted (sample tests are never confidential) unlike hidden-test results.

```bash
cd /home/shreesh/Documents/AlgoQX && make build && make test && make vet && make fmt-check && make lint
git add services/submission/
git commit -m "feat: add run status and run history endpoints"
```

---

## Task 6: Purge worker

**Files:**
- Create: `services/submission/internal/runpurge/store.go`, `runner.go`, `runtime.go`
- Create: `services/submission/migrations/<NNNN>_code_run_purge.up.sql` / `.down.sql`
- Test: `services/submission/internal/runpurge/runner_test.go`
- Modify: `services/submission/cmd/server/main.go`
- Modify: `services/submission/README.md`

**Interfaces:**
- Consumes: nothing from other tasks in this plan except the `code_runs`/`code_run_units` schema
- Produces: `submission.purge_expired_code_runs(p_limit integer) RETURNS integer`, wired worker in `main.go`

- [ ] **Step 1: Read the exact template**

```bash
cat services/submission/internal/expiry/store.go
cat services/submission/internal/expiry/runner.go
cat services/submission/internal/expiry/runtime.go
sed -n '1,50p' services/submission/migrations/000017_attempt_expiry_worker.up.sql
```

This is a byte-for-byte structural template: dedicated least-privilege role, `Ping` self-audit proving no direct table access, `SECURITY DEFINER` function doing bounded batched deletes with `FOR UPDATE SKIP LOCKED`.

- [ ] **Step 2: Write the migration**

Create `services/submission/migrations/<NNNN>_code_run_purge.up.sql`, mirroring `000017_attempt_expiry_worker.up.sql`'s exact shape (role creation guarded by `IF EXISTS (SELECT 1 FROM pg_roles ...)`, `SECURITY DEFINER` function, `REVOKE ALL ... FROM PUBLIC`):

```sql
SET ROLE aether_submission_owner;

CREATE FUNCTION submission.purge_expired_code_runs(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, submission, app
AS $function$
DECLARE
    purged_count integer := 0;
    run_row record;
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
        RAISE EXCEPTION 'purge batch limit must be between 1 and 5000' USING ERRCODE = '22023';
    END IF;

    FOR run_row IN
        SELECT id
        FROM submission.code_runs
        WHERE purge_after < CURRENT_TIMESTAMP
        ORDER BY purge_after
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    LOOP
        DELETE FROM submission.code_run_units WHERE code_run_id = run_row.id;
        DELETE FROM submission.code_runs WHERE id = run_row.id;
        purged_count := purged_count + 1;
    END LOOP;

    RETURN purged_count;
END
$function$;

DO $grant$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aether_submission_run_purge_worker') THEN
        GRANT USAGE ON SCHEMA submission TO aether_submission_run_purge_worker;
        GRANT EXECUTE ON FUNCTION submission.purge_expired_code_runs(integer)
            TO aether_submission_run_purge_worker;
    END IF;
END
$grant$;

REVOKE ALL ON FUNCTION submission.purge_expired_code_runs(integer) FROM PUBLIC;

RESET ROLE;
```

Then follow `000017`'s Step 4 exactly: add `aether_submission_run_purge_worker` to `deploy/database/platform/dev-init.sh`, same `NOLOGIN`/`NOBYPASSRLS` posture as `aether_submission_expiry_worker`.

Write the paired `.down.sql` (drop function, revoke grants — mirror `000017`'s down migration).

- [ ] **Step 3: Verify the migration**

Run: `make test-migrations`
Expected: PASS.

- [ ] **Step 4: Write the failing runner test**

Mirror `services/submission/internal/expiry/runner_test.go` exactly (fake store, `TestProcessOnceStopsOnShortBatch`, `TestProcessOnceRespectsMaxBatches`, `TestProcessOnceReturnsStoreError`, `TestNewRunnerRejectsDisabledRuntime`), substituting `ExpireOverdue`/`Purger` naming for `PurgeExpired`/`Purger` (or whatever interface name fits — match this new package's own naming, don't literally reuse `expiry`'s type names across packages).

- [ ] **Step 5: Run to verify it fails**

Run: `cd services/submission && go test ./internal/runpurge/ -v`
Expected: FAIL — package doesn't compile yet.

- [ ] **Step 6: Write runtime.go, store.go, runner.go**

Mirror the three `expiry` files exactly, substituting: role name `aether_submission_run_purge_worker`, function name `submission.purge_expired_code_runs`, env var prefix `SUBMISSION_RUN_PURGE_*`.

- [ ] **Step 7: Run to verify tests pass**

Run: `cd services/submission && go test ./internal/runpurge/ -v`
Expected: PASS.

- [ ] **Step 8: Wire into main.go**

Follow `services/submission/cmd/server/main.go`'s existing conditional-startup shape for the expiry worker exactly (load runtime, if enabled load a second pool via `config.LoadDatabase("SUBMISSION_RUN_PURGE")`, construct store+runner, add to readiness, start `Run` in a goroutine).

- [ ] **Step 9: Full verification, document, and commit**

```bash
cd /home/shreesh/Documents/AlgoQX && make build && make test && make vet && make fmt-check && make lint && make test-migrations
```

Document the worker in `services/submission/README.md` (what it does, its `SUBMISSION_RUN_PURGE_*` config, its dedicated role) and state the default purge window with reasoning (e.g., "a few days after grading completes, giving room for post-exam dispute investigation before storage is reclaimed").

```bash
git add services/submission/ deploy/database/platform/
git commit -m "feat: purge expired code runs with a least-privilege worker"
```

---

## Task 7: End-to-end integration test

**Files:**
- Create: `services/submission/test/integration/run_code_test.go` (or extend an existing integration test file if this service already has a `test/integration/` directory — check `services/submission/test/` first)

**Interfaces:**
- Consumes: everything from Tasks 1-6

- [ ] **Step 1: Check for an existing integration test harness in this service**

```bash
find services/submission -path '*test/integration*'
```

If one exists (following the pattern established in Wave 1's earlier integration-test work — Testcontainers Postgres, real migrations, a real HTTP handler), extend it. If not, create it following the exact five-phase shape used by `services/user/internal/adapters/repo/postgres_integration_test.go` and the six services added to that pattern in Wave 1.

- [ ] **Step 2: Write the integration test covering the full flow**

Cover: run against an item with a pinned sample bundle → `202` → poll until terminal → per-test-case results present; run against an item with no sample bundle → `409`; exhausting `runCodeLimiter` → `429`; run history list → cursor pagination returns runs newest-first; purge worker → a run past its `purge_after` is actually removed.

- [ ] **Step 3: Run and verify**

Run: `cd services/submission && go test -tags=integration ./test/integration/... -v`
Expected: PASS.

- [ ] **Step 4: Full verification and commit**

```bash
cd /home/shreesh/Documents/AlgoQX && make test-integration
git add services/submission/test/
git commit -m "test: cover the candidate run-code flow end to end"
```

---

## Completion checklist

- [ ] `assessment.exam_items` can carry an optional pinned sample bundle, validated the same way the hidden bundle is
- [ ] Candidates can dispatch a run against sample tests only, never hidden tests, structurally incapable of touching `evaluation_requests`/`judge_receipts`/`score_summaries`
- [ ] Run results show per-test-case detail (never redacted — sample content isn't confidential)
- [ ] Run history is visible during the live attempt, cursor-paginated
- [ ] Runs are rate-limited per candidate, generously (iteration-friendly, not per-hour-friction)
- [ ] A purge worker reclaims run history after a bounded post-grading window
- [ ] `make build`, `test`, `test-integration`, `vet`, `fmt-check`, `lint`, `test-migrations` all pass

## Notes for the executor

**On Task 4 Step 2 and Task 5 Step 1.** These are the two real design decisions left open in this plan — how submission learns about sample-bundle references cross-service, and whether run completions share formal-grading's ingestion path. Both deserve real investigation, not a fast guess; get them right, since a wrong choice here means either a broken cross-service read or duplicated completion-handling logic that drifts out of sync over time.

**On testing without real Judge0.** This plan's integration test will exercise the full dispatch path against whatever engine is configured (stub by default in this environment) — that's sufficient to prove the plumbing works. It does not prove real code execution works; that assurance comes from the `2026-08-24-judge0-real-adapter.md` plan's own scope, plus the eventual external gVisor validation.
