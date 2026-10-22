# ADR-0029: Staff review of an attempt

- Status: accepted
- Date: 2026-10-19

## Context

Faculty need to see what a student did: their code, what they submitted and
when, and what happened to the attempt (extra time, hand-in, grading). The
exam app offers this per attempt and keeps an audit log. Submission's only
staff view was per-test results (`judge-receipts`); a student's source was
readable only by the student, through the paper.

## Decision

`GET /v1/tenants/{t}/attempts/{a}/review` authorizes read on
`judge_receipts`, the reviewer resource that no candidate self scope can
obtain, so a student cannot read it even for their own attempt. It calls the
owner-bound `submission.get_attempt_review` (migration `000029`), which
returns for each question the latest answer's storage reference, the best
score, and every evaluation (Submit or hand-in, save number, time, per-verdict
counts, score), plus the finalized score and the attempt's event log from
`attempt_events`. Submission fetches, checksum-verifies and decrypts each
latest answer as it does for the paper; storage references never leave the
service. Responses are `Cache-Control: no-store`.

The staff frontend links each started row of the live monitor to the review.

## Consequences

- The event log is the attempt's audit trail: start, extra time with its
  author, Submit and hand-in (by the student or by time-up), grading,
  cancellation. Saves are not events; each save is an answer revision.
- Every staff role that can read results can read code. College
  administrators and department staff of the tenant can; mentors, who read
  only, can too.
