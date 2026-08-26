# Per-Unit Result Surfacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-test-case verdicts are already recorded inside judge's own database (`judge.execution_units.normalized_verdict`, written by the dispatcher's existing `RecordVerdict` call) but never leave judge — the gRPC `Completion` event only carries one aggregate verdict. This plan exposes per-unit results across the service boundary and persists them in submission, with a redacted view for candidates and full detail for faculty/reviewers.

**Architecture:** Add a `repeated UnitResult unit_results` field to the `Completion` proto message. Add a read method to judge's dispatcher `Store` interface to fetch per-unit results for a completed job, wire it into `PullCompletedExecutions`. On submission's side, extend the completion-ingestion path to persist per-unit rows alongside the existing `judge_receipts` row, and add a redacted read path for candidates vs. a full one for faculty.

**Tech Stack:** Go 1.26.7, protobuf/buf, pgx/v5.

**Spec:** `docs/superpowers/specs/2026-08-24-judge0-execution-and-run-code-design.md` (Phase C)

## Global Constraints

- Go module path for shared code is `github.com/aethercode/aethercode/libs/pkg`.
- No placeholders, stub bodies, `TODO` comments, or fake data may be committed.
- Every new SQL function is `REVOKE ALL ... FROM PUBLIC` then granted only to its intended role.
- Every migration ships a paired `.down.sql`. `make test-migrations` verifies fresh-apply, rollback, reapply.
- Tests are table-driven and call `t.Parallel()`.
- Commits use Conventional Commits.
- Raw stdout/stderr/expected-output content for hidden tests never crosses the judge→submission service boundary in structured form — only verdict + timing metadata does. This is a hard security constraint, not a style preference.
- **Environment (mandatory on every Go command):**
  `export PATH="$HOME/.local/go/bin:$HOME/go/bin:$PATH"`,
  `export TMPDIR="$HOME/.cache/aethercode-tmp"`, `export GOTMPDIR="$HOME/.cache/aethercode-tmp"`.

---

## Design

### Why no raw output crosses the wire

`Completion`'s existing fields already keep hidden-test content out of the wire format — `result_ref`/`result_encryption_key_reference` point at an encrypted object, never inlining stdout/stderr. The new `UnitResult` message follows the same discipline: verdict code, unit number, timing — nothing a candidate or an attacker intercepting the internal gRPC channel could use to learn hidden-test content. Candidates only ever see per-unit detail for their own **sample-test runs** (a completely separate feature, Wave 1's follow-up plan), never for hidden tests.

### The redaction boundary

Per an explicit product decision: candidates see a redacted `{passed, total}` count per item after formal grading; only faculty/reviewer roles see which specific hidden tests failed. This plan builds the data model and the role-gated read path; it does not build a review UI or workflow (that's a separate future sub-project on this platform's roadmap).

---

## Task 1: Proto — add UnitResult to Completion

**Files:**
- Modify: `libs/proto/proto/aethercode/judge/v1/judge.proto`

**Interfaces:**
- Produces: `judgev1.UnitResult{UnitNumber uint32, VerdictCode CompletionVerdict, ExecutionTimeMs *uint32, MemoryKib *uint32}`, `judgev1.Completion.UnitResults []*UnitResult`

- [ ] **Step 1: Read the current proto file in full**

```bash
cat libs/proto/proto/aethercode/judge/v1/judge.proto
```

Confirm `Completion`'s highest field tag is currently `13` (`verdict_code`) — the new field must use `14`, the next free number. If a different tag is already in use by the time this task runs, use whatever the next free number actually is.

- [ ] **Step 2: Add the message and field**

In `libs/proto/proto/aethercode/judge/v1/judge.proto`, add a new message near `Completion`:

```protobuf
message UnitResult {
  uint32 unit_number = 1;
  CompletionVerdict verdict_code = 2;
  optional uint32 execution_time_ms = 3;
  optional uint32 memory_kib = 4;
}
```

Add to the `Completion` message:

```protobuf
  repeated UnitResult unit_results = 14;
```

- [ ] **Step 3: Regenerate and verify**

Run: `make proto`
Expected: succeeds; `libs/proto/gen/go/aethercode/judge/v1/judge.pb.go` now contains `UnitResult` and `Completion.UnitResults`.

If `buf lint` flags anything about the new message/field naming, fix the proto to satisfy it rather than suppressing the rule (matching how a prior plan in this codebase handled the same situation for `DeleteExecutionJobRequest`/`HardDeleteExecutionJobRequest`).

- [ ] **Step 4: Commit**

```bash
cd /home/shreesh/Documents/AlgoQX
git add libs/proto/
git commit -m "feat: add per-unit results to judge's Completion proto message"
```

---

## Task 2: Judge — read per-unit results and populate Completion

**Files:**
- Modify: `services/judge/internal/dispatcher/store.go`
- Modify: `services/judge/internal/adapters/repo/store_adapter.go`
- Modify: `services/judge/internal/app/service.go`
- Modify: `services/judge/internal/adapters/grpc/server.go`
- Test: corresponding `_test.go` files for each

**Interfaces:**
- Consumes: `judgev1.UnitResult`, `judgev1.Completion.UnitResults` from Task 1
- Produces: `dispatcher.Store.FetchUnitResults(ctx, jobID string) ([]UnitResultRow, error)`, threaded through `app.Completion.UnitResults` and into the gRPC layer

- [ ] **Step 1: Read the current Store interface, the Completion domain type, and PullCompletedExecutions**

```bash
cat services/judge/internal/dispatcher/store.go
grep -n "type Completion struct" -A 20 services/judge/internal/app/*.go
sed -n '82,122p' services/judge/internal/adapters/grpc/server.go
```

- [ ] **Step 2: Write the failing store-adapter test**

Add to `services/judge/internal/adapters/repo/store_adapter_test.go` (or create it if it doesn't exist — check first) a test asserting `FetchUnitResults` returns unit rows in `unit_number` order for a completed job, using whatever test-database pattern the existing store-adapter tests already use (unit test with a mock/fake pool, or read the file to confirm the established style before writing new tests in a different style).

- [ ] **Step 3: Add `FetchUnitResults` to the Store interface**

In `services/judge/internal/dispatcher/store.go`:

```go
	// FetchUnitResults returns the terminal verdict for every unit of a
	// completed job, ordered by unit number, for surfacing per-test-case
	// detail to consumers outside the dispatcher.
	FetchUnitResults(ctx context.Context, jobID string) ([]UnitResult, error)
```

Add the `UnitResult` struct near `UnitVerdict` in the same file:

```go
// UnitResult is one unit's terminal outcome, read back after a job completes.
type UnitResult struct {
	UnitNumber int
	Verdict    string
	TimeMS     *int
	MemoryKB   *int
}
```

- [ ] **Step 4: Implement `FetchUnitResults` in the store adapter**

In `services/judge/internal/adapters/repo/store_adapter.go`, add:

```go
// FetchUnitResults returns every unit's recorded verdict for a job, in
// unit_number order.
func (a *DispatchStoreAdapter) FetchUnitResults(ctx context.Context, jobID string) ([]dispatcher.UnitResult, error) {
	rows, err := a.pool.Query(ctx, `
		SELECT unit_number, normalized_verdict, cpu_time_ms, memory_bytes
		FROM judge.execution_units
		WHERE job_id = $1
		ORDER BY unit_number
	`, jobID)
	if err != nil {
		return nil, fmt.Errorf("fetch unit results for job %s: %w", jobID, err)
	}
	defer rows.Close()

	results := make([]dispatcher.UnitResult, 0)
	for rows.Next() {
		var unitNumber int
		var verdict string
		var timeMS *int
		var memoryBytes *int64
		if err := rows.Scan(&unitNumber, &verdict, &timeMS, &memoryBytes); err != nil {
			return nil, fmt.Errorf("scan unit result for job %s: %w", jobID, err)
		}
		var memoryKB *int
		if memoryBytes != nil {
			kb := int(*memoryBytes / 1024)
			memoryKB = &kb
		}
		results = append(results, dispatcher.UnitResult{
			UnitNumber: unitNumber, Verdict: verdict, TimeMS: timeMS, MemoryKB: memoryKB,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate unit results for job %s: %w", jobID, err)
	}
	return results, nil
}
```

Verify the exact column names (`normalized_verdict`, `cpu_time_ms`, `memory_bytes`) against `services/judge/migrations/000001_judge_control_schema.up.sql`'s `judge.execution_units` definition before finalizing — use whatever the schema actually calls these columns if it differs from this guess.

- [ ] **Step 5: Thread through the app layer's Completion type**

Read `services/judge/internal/app/service.go`'s `Completion` struct and `Pull` method in full. Add a `UnitResults []dispatcher.UnitResult` (or an app-layer equivalent type, matching however this file already avoids leaking dispatcher-package types into the app layer if it does — check for an existing pattern of app-layer types mirroring dispatcher types before deciding whether to reuse `dispatcher.UnitResult` directly or define `app.UnitResult`) field, populated by calling `store.FetchUnitResults(ctx, completion.JobID)` for each completed job being pulled.

- [ ] **Step 6: Populate the proto field in the gRPC server**

In `services/judge/internal/adapters/grpc/server.go`'s `PullCompletedExecutions`, after the existing `response.Completions = append(...)` construction, add unit-result mapping:

```go
		unitResults := make([]*judgev1.UnitResult, 0, len(completion.UnitResults))
		for _, unit := range completion.UnitResults {
			unitVerdictCode, unitVerdictErr := completionVerdictCode(unit.Verdict)
			if unitVerdictErr != nil {
				return nil, status.Error(codes.Internal, "Judge completion vocabulary is invalid")
			}
			result := &judgev1.UnitResult{UnitNumber: uint32(unit.UnitNumber), VerdictCode: unitVerdictCode}
			if unit.TimeMS != nil {
				timeMS := uint32(*unit.TimeMS)
				result.ExecutionTimeMs = &timeMS
			}
			if unit.MemoryKB != nil {
				memoryKiB := uint32(*unit.MemoryKB)
				result.MemoryKib = &memoryKiB
			}
			unitResults = append(unitResults, result)
		}
```

and add `UnitResults: unitResults` to the `&judgev1.Completion{...}` literal already being constructed in this method. `completionVerdictCode` already exists in this file (used for the aggregate verdict) — reuse it unchanged.

- [ ] **Step 7: Run all judge tests**

Run: `cd services/judge && go test ./... -v`
Expected: PASS.

- [ ] **Step 8: Full verification and commit**

```bash
cd /home/shreesh/Documents/AlgoQX && make build && make test && make vet && make fmt-check && make lint
git add services/judge/
git commit -m "feat: surface per-unit verdicts through judge's completion event"
```

---

## Task 3: Submission — persist and redact per-unit results

**Files:**
- Create: `services/submission/migrations/00NNNN_judge_receipt_units.up.sql` / `.down.sql` (confirm next free migration number first)
- Modify: `services/submission/internal/adapters/judgecompletion/completion.go`
- Modify: `services/submission/internal/adapters/judgecompletion/store.go`
- Modify: `services/submission/internal/adapters/http/handler.go` (or wherever score/result data is read back — Task investigation required, see Step 1)
- Test: corresponding files

**Interfaces:**
- Consumes: `judgev1.Completion.UnitResults` (arrives via the existing judge-completion consumer pipeline)
- Produces: `submission.judge_receipt_units` table; a redacted `{passed, total}` view for candidates, full per-unit detail for faculty roles

- [ ] **Step 1: Trace the full existing completion-ingestion pipeline**

This pipeline has more hops than a first read suggests. Read, in order:

```bash
cat services/submission/internal/adapters/judgecompletion/completion.go
cat services/submission/internal/adapters/judgecompletion/store.go
sed -n '1,220p' services/submission/migrations/000010_judge_completion_bridge.up.sql
grep -n "INSERT INTO submission.judge_receipts" services/submission/migrations/*.up.sql
```

Confirm this chain precisely: `judgecompletion.Store.Persist` calls `SELECT submission.ingest_judge_completion(...)`, which — per `000010_judge_completion_bridge.up.sql:73-209` — inserts into `submission.judge_completion_ingress` (a dedup table) and `app.outbox_events` (event type `judge.completed.v1`), but does **not** insert into `submission.judge_receipts` directly. Find whatever consumes that outbox event and performs the actual `INSERT INTO submission.judge_receipts` (the SQL for that insert exists at `services/submission/migrations/000006_workflow_runtime_hardening.up.sql:116-124`, called from some function — find that function's name and what invokes it: another outbox-consuming worker, a trigger, or a synchronous call within the same transaction as `ingest_judge_completion`). This step's output determines exactly where in the pipeline `unit_results` needs to be threaded through — do not proceed to Step 2 until this is fully traced, since guessing wrong here means building the migration/table correctly but never actually populating it.

- [ ] **Step 2: Confirm the next free submission migration number**

Run: `ls services/submission/migrations/ | grep -oE '^[0-9]+' | sort -u | tail -3`

- [ ] **Step 3: Write the migration for `judge_receipt_units`**

Create `services/submission/migrations/<NNNN>_judge_receipt_units.up.sql`, a child table of `judge_receipts`:

```sql
SET ROLE aether_submission_owner;

CREATE TABLE submission.judge_receipt_units (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    judge_receipt_id uuid NOT NULL,
    unit_number integer NOT NULL CHECK (unit_number >= 0),
    verdict text NOT NULL
        CHECK (verdict IN ('accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded', 'runtime_error', 'compile_error', 'internal_error', 'cancelled')),
    execution_time_ms integer CHECK (execution_time_ms IS NULL OR execution_time_ms >= 0),
    memory_kib integer CHECK (memory_kib IS NULL OR memory_kib >= 0),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, judge_receipt_id, unit_number),
    FOREIGN KEY (tenant_id, judge_receipt_id)
        REFERENCES submission.judge_receipts (tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX judge_receipt_units_receipt_idx
    ON submission.judge_receipt_units (tenant_id, judge_receipt_id, unit_number);

-- RLS: same read/insert posture as judge_receipts itself. Read the existing
-- judge_receipts RLS policies first (grep "judge_receipts" in
-- services/submission/migrations/*rls*.up.sql) and mirror them exactly for
-- this new table — do not invent a different access pattern.

RESET ROLE;
```

Write the paired `.down.sql` dropping the table. Verify with `make test-migrations`.

- [ ] **Step 4: Extend `ingest_judge_completion` (or whatever function Step 1 identified as the real judge_receipts writer) to accept and persist unit results**

Based on Step 1's findings, extend the relevant SQL function's parameter list to accept a `jsonb` array of `{unit_number, verdict, execution_time_ms, memory_kib}` objects, and add an INSERT loop populating `judge_receipt_units` alongside the existing `judge_receipts` insert, in the same transaction. Ship this as part of the same migration file from Step 3 (`CREATE OR REPLACE FUNCTION`, matching this repo's established pattern for extending an existing function rather than editing an old migration file in place).

- [ ] **Step 5: Thread unit_results from the gRPC completion event through to the SQL call**

Modify `services/submission/internal/adapters/judgecompletion/completion.go`'s `Completion` struct to add a `UnitResults []UnitResult` field (define `UnitResult{UnitNumber int, Verdict string, ExecutionTimeMS *int, MemoryKiB *int}` in the same file), populated by whatever code currently constructs a `judgecompletion.Completion` from a `judgev1.Completion` (find that call site — likely in `worker.go` in the same package, since `completion.go` only defines the domain type). Modify `store.go`'s `Persist` to marshal `UnitResults` to JSON and pass it as the new parameter to the Step 4 SQL function.

- [ ] **Step 6: Write the candidate-redacted vs. faculty-full read path**

Read `services/submission/internal/adapters/http/handler.go`'s `getAttempt` in full, and `services/submission/internal/app/service.go`'s `GetAttempt` in full. Determine, from `libs/pkg/httpauth`, how a caller's role becomes available at the handler/service layer (the `AuthorizeHTTP` decision — check `decision.Capability` or whatever `AuthorizeHTTP` returns for role information; if role isn't already available post-authorization, find where role-checking exists anywhere else in this platform — e.g. `services/user/internal/app/authorization.go`'s `ActionPrefix`/`ResourcePrefix` pattern, or check whether roles are already encoded in the capability itself). Add a new field to the attempt/score read response: `HiddenTestSummary *struct{ Passed, Total int }` for every caller, and `HiddenTestDetail []judge_receipt_units-shaped rows` populated **only** when the caller's role grants faculty/reviewer-level access — read this codebase's existing role vocabulary (grep `super_admin|faculty|reviewer|department_user` across `services/user/migrations/*.up.sql` for the actual role names this platform uses) rather than inventing new role names.

- [ ] **Step 7: Tests**

Add: (a) a unit test on the SQL function via `make test-migrations`-adjacent fixture data proving `judge_receipt_units` rows get created; (b) a handler test proving a candidate-role response never contains per-unit detail, only the redacted count; (c) a handler test proving a faculty-role response contains full per-unit detail. Use whatever role-simulation mechanism this codebase's existing handler tests already use (check `services/submission/internal/adapters/http/handler_test.go` for how role/capability is faked in tests today).

- [ ] **Step 8: Full verification and commit**

```bash
cd /home/shreesh/Documents/AlgoQX && make build && make test && make vet && make fmt-check && make lint && make test-migrations
git add services/submission/
git commit -m "feat: persist per-unit judge results with role-gated visibility"
```

---

## Completion checklist

- [ ] `Completion.unit_results` (proto) carries per-unit verdict + timing, no raw output content
- [ ] Judge's `PullCompletedExecutions` populates `unit_results` from `judge.execution_units.normalized_verdict`
- [ ] Submission persists per-unit rows in `judge_receipt_units`, correctly threaded through whatever function Task 3 Step 1 identifies as the real `judge_receipts` writer
- [ ] Candidates see only a redacted `{passed, total}` count; faculty/reviewer roles see full per-unit detail
- [ ] `make build`, `test`, `vet`, `fmt-check`, `lint`, `test-migrations` all pass

## Notes for the executor

**On Task 3 Step 1.** This is the highest-risk step in this plan — the completion pipeline has more hops (ingress table → outbox → some other consumer → judge_receipts) than a surface read suggests, and guessing the wrong insertion point means the migration and Go code are both correct but the data never actually flows. Budget real time for this trace before writing any code.

**On role names.** Do not invent role vocabulary. This platform already has an established role hierarchy (Golden/Silver/Bronze medallion per PLAN.md, with specific role names used throughout `services/user`) — read it and reuse it exactly.
