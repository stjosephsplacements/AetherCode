# ADR-0017: The Go platform is the only backend

- Status: accepted
- Date: 2026-10-02
- Supersedes: the "separate backend" part of ADR-0016

## Context

ADR-0016 built `apps/exam-v1`, a single-server Next.js app with its own
Postgres and grading worker, because the Go microservices could not run an
exam and the first exam was two days away. On 2026-10-02 the stakeholder
decided the project must not keep a second backend. The first graded exam is
now 1–2 weeks away.

Running an exam on the platform needs:

- a closed grading loop: dispatching evaluations to the judge, and decrypting
  before dispatch;
- server-side upload of code and test cases;
- admin-created accounts and bulk import;
- a single-server deployment;
- a web frontend;
- every exam feature `apps/exam-v1` already has.

The estimate is 15–21 working days.

## Decision

1. All exam functionality is implemented in the Go services under their
   existing rules:
   - hexagonal layers;
   - RLS with signed capabilities;
   - contract-first changes;
   - idempotency and outbox events;
   - soft delete.
2. The exam app's screens move to `web/` and call the gateway. `web/` holds no
   database and no grading logic.
3. `apps/exam-v1` is **frozen**: no new features, security fixes only. It stays
   deployable as the fallback for exams held before the platform reaches
   parity, and is deleted when the platform passes the ported end-to-end test.
4. The work follows
   `docs/superpowers/plans/2026-10-02-go-platform-exam-parity.md`, phase by
   phase. Each phase ends green on `make build test lint test-integration`.

## Consequences

- Exams in the next 1–2 weeks either run on the frozen exam app or move.
- Every feature costs more than in the exam app: database functions, policies,
  contracts and events per service.
- Features the platform's model doesn't express yet need their own ADRs before
  implementation:
  - faculty authoring;
  - per-exam network allow-lists;
  - preview attempts;
  - multiple choice.
- One shared end-to-end spec defines "done" for both backends during the
  overlap.
