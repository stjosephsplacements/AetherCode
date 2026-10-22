# ADR-0033: Model-solution checks and per-client Judge completions

- Status: accepted
- Date: 2026-10-20

## Context

Authors need to run a correct solution on every test of a question, hidden
ones included, before students see it: a wrong expected output otherwise
surfaces as a lost mark in an exam. The exam app does this on its question
page. Only Judge runs code, and only Submission was its client. Judge's
completion outbox was one queue: any client pulling it would lease, and could
acknowledge, Submission's grading results.

## Decision

**Judge keeps each client's jobs apart.** Each job records the mTLS subject
of the service that submitted it (`execution_jobs.client_subject`, Judge
migration `000013`; existing jobs are `submission`). `PullCompletedExecutions`
and `AcknowledgeCompletion` return and accept only completions of the
caller's own jobs, and an idempotency key never resolves to another client's
job. The subject comes from the verified client certificate, so a client
cannot claim another's; without mTLS (development) every caller is
Submission. The contract (proto) is unchanged.

**Question Bank is a second Judge client.** Judge allows the subject
`question-bank`. `POST /v1/question-versions/{id}/model-checks` (an author,
write on question versions) encrypts the solution with the platform KMS,
stores it, records the check (`qbank.start_model_check`, migration `000016`:
the language must be allowed, the version must have tests, at most three
checks per version run at once) and submits a job on the version's
evaluation bundle with the question's limits. The check id is the job's
idempotency key and correlation id. A worker in Question Bank pulls its
completions every two seconds and records each test's verdict through the
projection worker role, which may only call `finish_model_check`; then it
acknowledges. `GET …/model-checks` lists the last ten checks.

## Consequences

- Grading is unaffected by model checks, and a model check cannot see or
  acknowledge a student's result.
- Authors see which test fails, by number, for hidden tests too; they wrote
  those tests.
- Upgrade order: Judge (with the subject allowed) before Question Bank.
