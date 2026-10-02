# ADR-0016: Lean exam app for the first graded launch

- Status: accepted
- Date: 2026-10-02

## Context

The college needs to run real graded coding exams for 1000+ students on a
single on-campus server within two days.

An audit of the microservices platform on 2026-10-02 found that the core exam
loop had never worked end to end:

- No service consumes `submission.evaluation_requested.v1` and calls the judge,
  so submitted code is never graded.
- Questions, test cases and answers expect pre-encrypted objects already uploaded
  to storage, but nothing in the system accepts raw code or test-case text and
  stores it.
- There is no bulk student import, and registration expects an email-verification
  flow with no email provider configured.
- `web/` is empty, so there is no UI at all.

The alternatives were: (A) build the missing pieces and a frontend on the
eleven-service platform, estimated at 5–7 days with untested cross-service
paths; (B) build a purpose-built single-server app for the first exam; (C) use
an existing tool such as Moodle + CodeRunner. The stakeholder chose (B).

## Decision

Build `apps/exam-v1`: one Next.js application, one Postgres database, and a
grading worker that calls Judge0 (or Piston) through a two-method engine adapter.
Scope is limited to:

- CSV student import with generated passwords
- question authoring with sample and hidden tests
- timed exams scoped to batches
- Run and Submit, with per-test results
- auto-submission of the final drafts at time-up
- focus-loss logging
- a live monitor and CSV result export

SEB, email, proctoring, high availability and the remaining roadmap items are out of scope.

The app does not share code or databases with the microservices. It lives in
this repository so the work stays reviewable in one place.

## Consequences

- **Security:** the app is protected by session cookies and server-side role
  checks, not by RLS or the signed authorization context. It must stay on the
  campus LAN, or behind HTTPS with `COOKIE_SECURE=true`. Student code runs only
  inside the Judge0/Piston sandbox; the app never executes it.
- **Operations:** there is one Postgres to back up and one worker to watch.
  Judge0 1.13 needs cgroup v1 on the host. Piston is the fallback for cgroup v2
  hosts.
- **Capacity:** grading throughput is bounded by Judge0 workers, roughly one test
  per CPU core at a time. A load test at the expected student count is
  required before the first graded exam.
- **Migration:** exam data is in plain tables (`users`, `questions`,
  `test_cases`, `exams`, `attempts`, `submissions`), so it can be imported into the
  platform once its grading loop works. The engine adapter is shaped like the
  judge service's `dispatcher.Engine`, so a custom execution engine can serve both.
- **Not a replacement:** the platform's open gaps (`PENDING.md`, `Prompt.md`)
  are unchanged and still block the microservices from going live.
