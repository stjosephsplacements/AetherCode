# Session Continuation Briefing

**Read this first if you are a fresh Claude Code session picking up this repo.** This file is self-contained — it does not assume you have access to any prior session's memory (memory may not sync across devices). Once you've internalized this, it's fine (and encouraged) to delete this file as part of whatever you do next, since its only job is to get you oriented.

**Branch:** `feat/list-endpoints-cursor-pagination` (yes, the name is stale relative to what's actually on it now — it started as a list-endpoints feature branch and has since accumulated a full production-readiness effort on top). **Base:** `master`. **PR:** [#1](https://github.com/Shreesh-Sree/CoderQX/pull/1), already open against master — new commits on this branch update that PR automatically, no new PR needed unless the user asks for one.

Read `CLAUDE.md` at the repo root next — it has the non-negotiable project conventions (simplicity first, no placeholders, hexagonal layering, soft-delete-by-default, etc.) that every task in this repo must follow.

---

## What this repo is

AetherCode: a multi-tenant coding-exam platform for colleges (Golden/Silver/Bronze role hierarchy, exams locked down via Safe Exam Browser). Eleven Go microservices (`gateway, identity, tenant, user, question-bank, assessment, submission, judge, seb, notification, analytics`) plus a `web/` Next.js frontend that is currently **completely empty** (out of scope for backend work). See `PLAN.md` for the architecture.

## How we got here (chronological)

1. **PR #1** closed out a large batch of prior production-readiness work: list endpoints, observability, Helm charts, object storage/KMS, the judge dispatcher's core plumbing, and a "Wave 1" of 7 bounded fixes (rate limiting, exam section/item removal, RLS integration test coverage across 6 services, an HMAC key-rotation CLI, etc.) — all merged into this same branch's history already.
2. A full-backend gap audit (4 parallel research agents) surfaced what was still missing, product-feature-wise, on top of the infra work.
3. The user asked to work through **11 candidate feature areas**, one at a time, each getting a full brainstorm → spec → plan → implementation cycle. Sub-project **#1 of 11** — "candidate run-code / sandbox execution" — turned out to require building **real Judge0 code execution first** (the platform only had a fake stub engine that always returned "accepted" regardless of submitted code). That grew into a 4-phase spec: `docs/superpowers/specs/2026-08-24-judge0-execution-and-run-code-design.md`, implemented as **4 sequential plans**:
   - `docs/superpowers/plans/2026-08-24-judge0-real-adapter.md` — **✅ COMPLETE.** Real Judge0 HTTP client.
   - `docs/superpowers/plans/2026-08-24-judge-testcase-fanout.md` — **✅ COMPLETE.** Unpacks a submission's test bundle into per-test-case units.
   - `docs/superpowers/plans/2026-08-24-judge-per-unit-results.md` — **✅ COMPLETE.** Surfaces per-test-case verdicts through to submission, with a candidate-vs-faculty access boundary.
   - `docs/superpowers/plans/2026-08-24-candidate-run-code.md` — **🔶 IN PROGRESS, 3 of 7 tasks done.** The actual candidate-facing feature. **This is where you resume.**

Every one of these plans was executed via the `superpowers:subagent-driven-development` skill: fresh implementer subagent per task → task-scoped review → fix loop if needed → final whole-branch review per plan → fix wave → close out.

## What's still open in Plan D (`candidate-run-code`)

**Workspace:** `.superpowers/sdd/2026-08-24-candidate-run-code/` — **do not delete this**, it's mid-flight (per the `subagent-driven-development` skill's own rule, workspaces only get deleted after a plan's final review is clean). Its `progress.md` ledger has the full task-by-task history and rulings; read it before doing anything else.

**Done:** Task 1 (sample-bundle pinning on exam items), Task 2 (`code_runs`/`code_run_units` schema), Task 3 (storage/KMS + rate-limiter wiring into submission).

**Not started:** Task 4 (the run-dispatch endpoint), Task 5 (run status/history endpoints), Task 6 (purge worker), Task 7 (integration test), then Plan D's own final whole-branch review.

**To resume:** invoke `superpowers:subagent-driven-development` on `docs/superpowers/plans/2026-08-24-candidate-run-code.md`. The skill will find the existing ledger and resume at Task 4 automatically (its own instructions cover this — "tasks with a Task N: complete line are DONE, resume at the first task without one"). Two things the ledger already flags that Task 4's dispatch must carry forward — re-read them from the ledger directly, but headline versions:

1. **Task 4 has REQUIRED scope beyond its own plan text**: the plan document itself was amended (commit `bf25eb0`) with a note that Task 4 must also close a decrypt-before-dispatch gap in `services/judge/internal/adapters/repo/store_adapter.go`'s `FetchQueuedJob` — it currently passes encrypted object-storage keys straight through to the execution engine as if they were literal plaintext source/stdin. This was harmless while no job could ever be admitted (an earlier, separate gap), but Plan D's Task 4 is what finally makes jobs admissible, so it must supply the missing decrypt step or every real run will silently ship garbage to Judge0.
2. **`submission.code_runs` currently only has `SELECT, INSERT` granted** (Task 2's finding) — no `UPDATE` path exists yet for `lifecycle_state` transitions. Task 4/5 must add either an `UPDATE` grant or a `SECURITY DEFINER` transition function before a run can ever leave the `queued` state.

## After Plan D is fully done

Per the brainstorming skill's decomposition, sub-project #1 (this whole Judge0-execution-and-run-code effort) will then be complete. **The user's explicit, standing preference (confirmed via AskUserQuestion earlier this session) is to check in before starting the next sub-project**, not barrel on automatically. The remaining 10 sub-projects, in the previously-agreed order, are:

2. Practice/contest mode (reuses #1's sandbox execution)
3. Proctoring runtime (policy config already exists; runtime/violation-detection doesn't)
4. Analytics/reporting dashboards (data's already captured, no read API yet)
5. Audit log reads (no `audit_log` table exists anywhere yet)
6. Grievance/re-evaluation workflow (depends on #5)
7. Question authoring workflow improvements
8. Accessibility accommodations
9. Placement/recruitment workflow (needs its own product-scope discussion)
10. Plagiarism/code-similarity detection
11. LMS/SIS integration (needs the user to name target systems)

Do not start #2 without checking in first, per the standing preference above.

## Real production bugs found and fixed this session (for context — all already fixed and merged)

This judge/submission code path had never been exercised end-to-end before this session, so a lot of latent bugs surfaced. All of these are already fixed, tested, and merged into this branch — listed here only so you don't rediscover them and think something's still wrong:

- `execution_events.event_type`'s CHECK constraint had a double-escaped regex that rejected every real value — every successful `Submit` call had been failing since the schema was created.
- `execution_units.normalized_verdict`'s CHECK constraint spelled `compilation_error` while every actual writer/reader used `compile_error` — a real compile error could never be persisted.
- The per-unit result query had no state filter, which would have poisoned entire gRPC pull batches with empty verdicts from non-terminal units.
- A migration upgrade-window edge case could have stalled the entire judge-completion bridge indefinitely on a redelivered pre-upgrade message.
- Judge's dispatcher engine switch statement was found **empty (uncommitted, broken working-tree state)** twice during this session, both times from session-limit interruptions leaving a subagent's edit half-done. Both times it was caught via the user's IDE selection and reverted to the last good commit — HEAD was never actually broken, only the uncommitted working tree was. If you ever see `switch dispatcherRuntime.EngineType { }` with no cases in `services/judge/cmd/server/main.go`, that's this same failure mode recurring — check `git status`/`git diff` on that file before assuming it's intentional, and `git checkout -- <file>` to revert if it's an incomplete uncommitted edit with no compensating logic added elsewhere.

## Real bugs found but explicitly NOT fixed (flagged as follow-ups, still open)

- `app.hard_delete('users.students', ...)` can never succeed for any real enrolled student (FK/trigger chain blocks it; soft-delete never clears the path) — a real gap against ADR-0013's soft-delete guarantees. Documented in `docs/adr/0013-soft-delete-architecture.md`'s Known Limitations. Needs a real design decision (cascade order, or a status-transition-then-delete flow).
- `services/analytics/internal/adapters/projection/projection.go`'s `judge.completed.v1` decoder is missing a `completed_at` field while decoding with `DisallowUnknownFields()` — every real event has been permanently rejected, so `analytics.judge_completion_projections` has never been populated. One-field fix, needs its own task.
- `extensions.uuid_generate_v7()` is called at 5 sites in `services/assessment/migrations/000010` and `000011` but is **defined nowhere in the repo** (not pgcrypto, not uuid-ossp, not any migration) — will fail at runtime whenever those specific code paths actually execute, since PL/pgSQL bodies aren't resolved at `CREATE` time.
- The judge-completion "reviewer" full-detail view (`services/submission/migrations/000018`) is tenant-wide, not batch/department-scoped — inherited from the platform's pre-existing authorization scope model (`assignmentApplies` in `services/user`), documented in `docs/adr/0015-judge-per-unit-result-visibility.md`'s Consequences section. Needs a platform-level task, not a local fix.
- The Helm chart at `deploy/helm/charts/judge-control/` uses env var names (`JUDGE_ENGINE_ENDPOINT`, `JUDGE_ENGINE_AUTH_TOKEN`) that don't match what the Go config actually reads (`JUDGE0_BASE_URL`, `JUDGE0_AUTH_TOKEN`), and never sets `JUDGE_DISPATCHER_ENABLED`/`JUDGE_ENGINE` at all — no combination of the chart's current values would deploy a working judge0-engine pod. Needs chart alignment before any real production judge0 rollout.
- `services/submission/internal/adapters/http/handler.go`'s `hardDeleteAttempt` calls `AuthorizeHTTP` with action `"delete"`, but the platform's `validateRequest` only ever accepts `"read"`/`"write"` — this route can never be authorized, ever. Dead but fails closed (safe direction), not urgent.
- `services/submission/migrations/000016_attempt_list_functions_test.sql` is dead — `scripts/verify-migrations` never globs `*_test.sql`, so it's never executed.

## User preferences established this session (follow these without being re-told)

- **Default to HackerRank-grade UX** on candidate-facing exam/coding features — per-test-case result detail, not just aggregate pass/fail; a clear separate "Run" vs "Submit" action; recent-run visibility during the live attempt, not just post-hoc. Lead with the richer/more-complete design option, not the minimal one, when presenting choices.
- Check in before starting a new sub-project (see the 11-item list above), but within a sub-project's own sequential sub-plans, keep executing continuously without asking at every step.
- When a review or investigation surfaces a real bug outside the current task's scope, the established pattern is: **fix it if cheap and load-bearing, otherwise document it clearly (ADR / ledger / this file) and flag it — never silently drop it, never silently expand scope to fix everything.**

## Where to look for more detail

- `docs/superpowers/specs/2026-08-24-judge0-execution-and-run-code-design.md` — the full 4-phase design this sub-project implements.
- `docs/superpowers/plans/2026-08-24-*.md` — the four plan documents, each with full task-by-task detail.
- `docs/adr/0014-evaluation-bundle-format.md`, `docs/adr/0015-judge-per-unit-result-visibility.md` — architecture decisions made during this work.
- Each touched service's `README.md` — updated as part of every task that changed its API surface or config.
