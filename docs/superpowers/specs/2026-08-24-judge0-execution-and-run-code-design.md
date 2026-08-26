# Real Code Execution and Candidate Run-Code — Design

**Status:** Approved for planning
**Owners:** AetherCode backend
**Related:** PLAN.md (judge service), `docs/adr/` (none yet — see Open Questions), production-readiness audit 2026-08-23 (Sub-J remaining, Sub-N)

## 1. Problem

Two related gaps, discovered together while scoping a "run code" feature:

1. **The platform cannot actually execute candidate code.** `services/judge` only has a fake `Stub` engine that accepts any submission and always returns "accepted," regardless of content. Real Judge0 integration was never built. Formal grading today produces meaningless results.
2. **Candidates cannot run their code against sample tests before submitting.** Every coding platform candidates are used to (HackerRank, LeetCode, Codeforces) lets you iterate — write code, run it against visible test cases, see exactly what passed/failed, fix, repeat — before committing to a formal submission. This platform has no such loop; the only action available is `submit`, which is graded, final, and asynchronous.

These are coupled: a "run" feature is worthless against a fake engine, and both need the same missing piece — a real execution engine that reports results per test case, not just one aggregate pass/fail.

## 2. Goals

- Real Judge0 execution, wired behind the platform's existing compatibility-approval gate.
- Per-test-case result granularity (HackerRank-grade: pass/fail + actual-vs-expected diff per test, not just an aggregate verdict), for both the new run-code feature and — as a byproduct — formal grading's post-exam review surface.
- A candidate-facing "run code" endpoint that executes against a question's **sample** test cases only, never the hidden grading set, with results visible during the live attempt (not just after the fact).
- No weakening of tenant isolation, hidden-test confidentiality, or the soft-delete/audit posture the rest of the platform holds to.

## 3. Non-goals

- Clearing the gVisor sandboxing compatibility gate itself (`deploy/validation/judge0-gvisor`) — that's an explicit external approval step this design cannot close. Phase A ships code-complete and unit-tested against a mocked Judge0 API; true end-to-end validation against a live, gVisor-sandboxed Judge0 instance happens after that approval lands, outside this plan's scope.
- Custom-input execution (candidate-supplied stdin outside the question's own test cases) — explicitly deferred per an earlier scoping decision in favor of sample-tests-only.
- Any change to how *formal* submissions are graded (still all-or-nothing per item at the score level) — Phase C only adds a *visibility* layer (per-hidden-test pass/fail counts) on top of the existing scoring model, it does not introduce partial credit.
- Real-time collaborative editing, IDE features (autocomplete, linting) — out of scope, this is backend execution plumbing only.

## 4. Architecture overview

Four phases, each independently testable, built in this order because each is a real dependency of the next:

```
Phase A: Real Judge0 client        (services/judge, new adapter)
    ↓ (Engine interface already exists; this fills it in)
Phase B: Test-case fan-out         (services/judge, job-admission path)
    ↓ (execution_units already exist; this populates them from a bundle)
Phase C: Per-unit result surfacing (proto + submission schema)
    ↓ (per-unit verdicts already recorded internally; this exposes them)
Phase D: Run-code feature          (assessment + submission, candidate-facing)
```

Phases A–C are genuinely "finish building the execution engine" work and directly benefit formal grading too, independent of Phase D ever shipping.

## 5. Phase A: Real Judge0 adapter

**New file:** `services/judge/internal/adapters/judge0/client.go`, implementing the existing `dispatcher.Engine` interface unchanged:

```go
type Engine interface {
    Submit(ctx context.Context, req UnitRequest) (token string, err error)
    Poll(ctx context.Context, token string) (*UnitVerdict, error)
}
```

`Submit` calls Judge0's `POST /submissions?base64_encoded=true&wait=false` with `{source_code, language_id, stdin, cpu_time_limit, memory_limit}` (base64-encoded per Judge0's API contract to avoid encoding issues with arbitrary source), returns the `token` field. `Poll` calls `GET /submissions/{token}?base64_encoded=true&fields=status,stdout,stderr,compile_output,time,memory,exit_code`, maps Judge0's numeric `status.id` (3=Accepted, 4=Wrong Answer, 5=TLE, 6=Compile Error, 7-12=various runtime errors, 13=Internal Error, 14=Exec Format Error) to this platform's existing verdict vocabulary, and returns `nil` (not-yet-terminal) for `status.id` 1-2 (In Queue, Processing) so the existing `pollUntilDone` retry loop in `worker.go` keeps working unchanged.

**Language mapping:** `services/judge/internal/adapters/judge0/languages.go` — a `map[string]int` from this platform's language keys to Judge0's language IDs. No canonical language-key list exists yet in this codebase (`question_versions.supported_languages` is free-form `[]string`); this design establishes one: `python3` → 71, `java` → 62, `cpp17` → 54, `c` → 50, `javascript` → 63, `go` → 60. Unmapped keys return a clear validation error rather than silently picking a default. Extending the set later is a one-line map addition, not a schema change.

**Wiring:** `services/judge/cmd/server/main.go`'s existing `case "judge0":` branch (currently: warn-and-no-op) constructs the real client and passes it into `NewWorker`, but only when `EngineCompatibilityApproved` is true — reusing the gate that already exists, not introducing a new one.

**Config:** new `JUDGE0_BASE_URL` env var (required when `JUDGE_ENGINE=judge0`), following the existing `services/judge/internal/config/runtime.go` validation style.

**Testing:** `httptest.Server` fixtures replaying Judge0's documented response shapes for every terminal status, plus queue/processing intermediate states to exercise the poll loop, plus network-error and malformed-response handling. This is real, mergeable, reviewable test coverage — it just can't prove the *real* Judge0 service behaves as documented, which is what the external gVisor validation step is for.

## 6. Phase B: Test-case fan-out

**Problem:** `judge.execution_units` (one row per test case, `unit_number`, `test_case_ciphertext_ref`, own `judge0_token`/state) already exists and the dispatcher `Worker` already iterates `job.Units` and records a verdict per unit — but nothing currently *creates* those unit rows from a submission's `evaluation_bundle_ref`, which today references one opaque bundle covering all test cases together.

**Fix:** at job-admission time (wherever `judge.execution_jobs` rows are currently created — the `SubmitExecution` RPC handler path), after the job row is inserted: fetch the evaluation bundle via the existing object-storage port, decrypt it (existing KMS adapter), parse its manifest (test-case count + per-test-case object references — this may require the bundle format itself to carry a small index/manifest of its N test cases, which question-bank's bundle-assembly step needs to produce; read `services/question-bank/internal/app/service.go`'s bundle-assembly logic before implementing this to confirm the current bundle shape, and extend it if it doesn't already separate individual test cases), and insert N `judge.execution_units` rows, each referencing one test case's own encrypted content via `test_case_ciphertext_ref`.

**No RPC/proto change needed** — `SubmitExecutionRequest` already just carries one `evaluation_bundle_ref`; this is purely internal judge-service fan-out logic.

## 7. Phase C: Per-unit result surfacing

Per-unit verdicts are already recorded via `Store.RecordVerdict(unitID, verdict)` (existing), but trapped inside judge's own database — nothing outside judge ever reads them today.

**Proto change** (`libs/proto/proto/aethercode/judge/v1/judge.proto`, regenerated via `make proto`, same process as Wave 1's Task 4): add a `repeated UnitResult unit_results` field to the `Completion` message —

```protobuf
message UnitResult {
  uint32 unit_number = 1;
  CompletionVerdict verdict_code = 2;
  optional uint32 execution_time_ms = 3;
  optional uint32 memory_kib = 4;
}
```

Deliberately **no** `stdout`/`stderr`/`expected_output` fields on the cross-service message — hidden-test content stays inside judge's encrypted result object (`result_ref`), never transiting the wire in structured form outside it. Only the *shape* of the outcome (which unit, what verdict, timing) crosses the service boundary.

**Submission schema**: new `submission.judge_receipt_units` table (evaluation_request_id, unit_number, verdict, execution_time_ms, memory_kib), child of the existing `judge_receipts`, populated when a completion event with `unit_results` is ingested.

**Visibility split** (per your explicit choice — redacted breakdown for candidates, full detail for faculty):
- **Candidates**, after formal grading completes: a redacted summary only — `{passed: 7, total: 10}` per item, no indication of *which* hidden tests failed or their content. Surfaced via a new field on the existing attempt/score read path, not a new endpoint.
- **Faculty/reviewers** (already-existing roles with grading/review scope): full per-unit breakdown including verdict per test number — this becomes the evidence surface for sub-project #6 (grievance/re-evaluation workflow) later; this design just makes the data exist and be queryable, it does not build the review UI/workflow itself.

## 8. Phase D: The run-code feature

**Schema — sample bundle pinning:** new migration on `services/assessment`, mirroring the existing hidden-bundle column pair exactly (`ALTER TABLE assessment.exam_items ADD COLUMN evaluation_bundle_object_key text CHECK (...)` from migration 000006 is the precedent):

```sql
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
```

Both nullable, matching the existing pattern (a question version might have no sample manifest at all — `qbank.test_case_manifests` doesn't require one to exist). `AddExamItem`'s app-layer command and HTTP request body gain two optional fields, supplied by the same caller (exam author's client) that already supplies the hidden-bundle reference — no new cross-service call.

**New endpoints** (`services/submission/internal/adapters/http/handler.go`):

- `POST /v1/tenants/{tenant_id}/attempts/{attempt_id}/items/{exam_item_id}/run` — body: `{language_id, source}`. Validates the attempt is active and owned by the caller, the exam item has a pinned sample bundle (409 with a clear message if not — "this question has no sample tests, code cannot be run standalone"), rate-limits per attempt (new `libs/pkg/ratelimit.Limiter` instance, separate from judge's tenant-wide `SubmitExecution` guard), encrypts + uploads the source through the same object-storage/KMS path `appendAnswerRevision` already uses, and dispatches to judge via the existing gRPC `SubmitExecution` — pointed at `sample_bundle_object_key`, not the item's hidden bundle. Returns a `run_id` immediately (async, matching the rest of this platform's dispatch pattern).
- `GET /v1/tenants/{tenant_id}/attempts/{attempt_id}/runs/{run_id}` — polled client-side until terminal. Once complete, returns the full per-test-case breakdown (pass/fail, actual output, expected output, time/memory per sample test) — **not** redacted, since these are the candidate's *own* sample tests, not hidden ones.
- `GET /v1/tenants/{tenant_id}/attempts/{attempt_id}/items/{exam_item_id}/runs` — cursor-paginated list of the candidate's recent runs for this item, visible during the live attempt (HackerRank-style run history panel), following the same cursor pattern already established for every other list endpoint on this platform (Wave 0's list-endpoints work).

**New table** `submission.code_runs`: id, tenant_id, attempt_id, exam_item_id, candidate_id, language_id, source ciphertext ref, judge_job_id, lifecycle_state, per-unit results (denormalized JSON or a child table mirroring `judge_receipt_units` — implementer's call at plan time, whichever fits this file's existing conventions better), created_at, purge_after.

**Retention**: purged by a new least-privilege worker, mirroring the existing `submission.expire_overdue_attempts` pattern exactly (dedicated role, `SECURITY DEFINER` function, `FOR UPDATE SKIP LOCKED` batching) — purges runs some fixed window after their attempt's grading completes (exact window is an implementation-time config default, not a hard product requirement; a few days is reasonable for post-exam dispute investigation).

## 9. Error handling

- **Judge0 unreachable during a run**: `Submit`/`Poll` return an error, the run transitions to a `failed` lifecycle state with a candidate-facing "execution service temporarily unavailable, try again" message — never a silent hang. The candidate can retry (subject to the rate limiter).
- **No sample bundle pinned**: `409 Conflict` at run-request time, not a confusing empty result.
- **Rate limit exceeded**: `429` with `Retry-After`, matching every other rate-limited endpoint from Wave 1.
- **Compile error vs. runtime error vs. wrong answer**: surfaced as visually/semantically distinct verdict codes (already distinguished in the existing verdict vocabulary — `compile_error`, `runtime_error`, `wrong_answer` are already separate enum values), so the client can render them differently without backend changes beyond what Phase A/C already produce.
- **Partial completion** (some sample units finish, others time out): the run's overall state only becomes terminal once every unit resolves (existing `MarkJobComplete` semantics, unchanged) — no partial results shown mid-flight beyond "still running."

## 10. Security & tenant isolation

- Hidden test content never crosses into the run-code path — `sample_bundle_object_key` is a structurally distinct column from `evaluation_bundle_object_key`, and the new endpoint only ever reads the former.
- `code_runs` rows are tenant-scoped and RLS-protected the same way `answer_revisions`/`attempts` already are (Task 6's integration-test pattern from Wave 1 extends naturally to this new table).
- The Phase C proto change deliberately excludes raw output content from the cross-service wire format — only verdict/timing metadata crosses, keeping hidden-test stdout/expected-output confidential inside judge's own encrypted storage.
- Rate limiting on the run endpoint prevents both resource exhaustion and using repeated runs as a side channel to slowly probe anything beyond the sample set (moot for hidden tests specifically, since runs never touch them — but still relevant for judge0/infra cost control).

## 11. Testing strategy

- Phase A: `httptest`-mocked Judge0 API, full status-code coverage, poll-loop retry/timeout behavior. No live Judge0 dependency in CI.
- Phase B: unit tests on the bundle-unpacking logic against fixture bundles with known test-case counts; verify `execution_units` row count and content match the bundle.
- Phase C: proto round-trip tests (existing `buf breaking` gate catches accidental incompatibility); submission-side ingestion tests verifying `judge_receipt_units` rows are created correctly and the candidate-facing redaction actually redacts (an explicit test asserting the API response contains no per-hidden-test detail for the candidate role, only for faculty roles).
- Phase D: full integration test (Testcontainers, following the Wave 1 pattern) covering: run against a pinned sample bundle → per-test-case result returned; run against an item with no sample bundle → 409; rate limit exhaustion → 429; run history list → cursor pagination; purge worker → old runs actually removed.

## 12. Open questions for plan-time (not blocking spec approval)

- Exact bundle manifest format for Phase B's test-case fan-out — needs a read of question-bank's current bundle-assembly code before finalizing, flagged in section 6.
- Whether `code_runs`' per-unit results are stored as JSON on the row or a proper child table — style call, not an architectural one.
- Exact purge window default (days) for `code_runs` retention.
