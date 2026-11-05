# ADR-0073: Projection consumers tolerate additive fields

- Status: accepted
- Date: 2026-11-06

## Context

Services project each other's outbox events (`*.snapshot.v1`) into their own tables. All six consumers
decoded with `DisallowUnknownFields`, so a publisher that added one field made every consumer fail
the event on each retry. The projection then stalled and the service reported not ready. This took the
platform down three times: when question content was added to assignment snapshots (#119), when the
exam title and instructions were added (User service, 2026-11-05) and when `kind` and
`placement_department_id` were added (Analytics, 2026-11-05). Rolling upgrades make it worse, because
the publisher always rolls out before some of its consumers.

## Decision

- Consumers read the fields they declare and ignore the rest. `DisallowUnknownFields` is removed from
  all six projection decoders (assessment, analytics, notification, question-bank, submission, user).
- Adding a field to an event is a compatible change within `schema_version` 1. Removing or retyping a
  field, or changing its meaning, needs a new schema version and a consumer that handles both.
- Every other check stays: required fields, UUID and range validation, one JSON value per payload.
- Privacy by construction: a consumer stores only what its struct declares, so a reference such as a
  source-object key that a publisher adds by mistake is dropped, not stored. Analytics tests that
  guarantee this replace the old "reject unknown field" cases.

## Consequences

- A newer publisher can never stall an older consumer.
- A typo in a publisher's field name is no longer caught by the consumer; the publisher's tests and the
  contract tests carry that check.
