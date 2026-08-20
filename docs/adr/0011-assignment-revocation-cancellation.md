# ADR-0011: Assignment revocation cancels nonterminal candidate work

- Status: accepted
- Date: 2026-07-24

## Context

Published assessment assignments are consumed by the User, Submission, and
Analytics services through immutable, versioned snapshots. A staff member can
revoke an assignment while a candidate has an open attempt or while its
evaluation is queued. Leaving that work active would allow a withdrawn exam to
produce a later result.

## Decision

Assessment publishes a higher-version
`assessment.candidate_assignment.snapshot.v1` tombstone with
`lifecycle_state=revoked`. Consumers retain that tombstone and ignore older
snapshots. Submission atomically cancels only nonterminal attempts and their
queued or dispatched evaluation requests, then emits one durable
`submission.attempt_cancelled.v1` event per attempt. Terminal attempts remain
an immutable historical record. A late Judge completion is acknowledged but
cannot change a cancelled attempt.

## Consequences

Revocation is eventually delivered across service boundaries, but each
consumer is monotonic and idempotent. It cannot resurrect access when an older
event is replayed, cannot grade cancelled work, and leaves an auditable
cancellation fact for Analytics. New attempt authorization must also consult
the active assignment projection, so an already-observed tombstone denies new
work immediately.
