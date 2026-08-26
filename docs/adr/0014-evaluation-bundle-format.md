# ADR-0014: Evaluation bundle JSON format and per-test-case object encryption

- Status: accepted
- Date: 2026-08-25

## Context

`judge.execution_jobs.evaluation_bundle_object_key` (and its
`evaluation_bundle_sha256` checksum) has existed since the wrapper's
foundation schema, but until the test-case fan-out plan nothing in this
codebase ever parsed the object it points to. Every consumer — including
`Postgres.Submit` itself — treated the bundle as a fully opaque encrypted
blob: it was received, checksummed, and referenced, never opened. The
dispatcher (`internal/dispatcher`), which already fans out per-unit work and
records per-unit verdicts, had no real per-test-case data to dispatch,
because `judge.execution_units` was never populated.

Some component upstream of Judge (exam-authoring/question-bank tooling) must
assemble this bundle before a submission ever reaches `SubmitExecution`. No
such bundle-assembler exists anywhere in this codebase today; this ADR
documents the contract that tooling must satisfy when it is built, not an
implementation of it.

## Decision

The evaluation bundle is a JSON document, encrypted as a single object (same
KMS mechanism as every other encrypted reference in this platform) and
referenced by `evaluation_bundle_object_key` /
`evaluation_bundle_sha256` / `evaluation_bundle_key_reference`:

```json
{
  "schema_version": 1,
  "test_cases": [
    { "stdin": "5\n3\n", "expected_output": "8\n" },
    { "stdin": "10\n-2\n", "expected_output": "8\n" }
  ]
}
```

`schema_version` allows the shape to evolve later without breaking bundles
already in flight or already stored. `internal/bundle.Parse` is the sole
parser: it decodes with `DisallowUnknownFields`, rejects any
`schema_version` other than the one version it currently supports, rejects
zero test cases, and bounds the test-case count (`maxTestCases = 500`) so a
pathologically large bundle cannot make one submission fan out into
thousands of dispatch units. It also bounds the raw ciphertext byte size
read from storage before decryption, independent of the post-parse count
bound.

Fan-out (`Postgres.Submit`, inside the same transaction that creates the
`execution_jobs` row) decrypts the bundle once, then re-encrypts **each test
case independently** and uploads it as its own object before inserting its
`judge.execution_units` row (`test_case_ciphertext_ref` +
`encryption_key_reference`). Test cases are not kept inline in the bundle
past this point. This was a deliberate choice over the simpler alternative
of leaving all test cases in the one bundle object and having the dispatcher
read offsets out of it: a single leaked or compromised per-unit ciphertext
exposes only that one test case, not every hidden test case for the
question, matching the "narrowest blast radius" posture the rest of this
platform's encryption boundaries already follow (e.g. per-submission source
ciphertext, per-result ciphertext).

### Why this needed integration-level test coverage

This plan's own migration `000007` fixed a pre-existing bug: the original
`execution_events.event_type` CHECK constraint used a double-escaped regex
that never matched any real event type Postgres wrote, so every `Submit`
call that reached the `execution_events` insert failed with a constraint
violation — silently, since nothing had ever exercised that INSERT against a
real database. The bug had been present since the schema was first created
and was invisible to unit tests using fakes/mocks for the persistence layer.
It was only caught once this plan added a Testcontainers integration test
that ran `Postgres.Submit` end to end against a real PostgreSQL instance.
This is the reason fan-out's test suite includes real-database integration
coverage, not just unit tests against fake storage/KMS: a code path that
never executes a real INSERT/UPDATE against the actual schema can hide a
constraint bug indefinitely.

## Consequences

Any future bundle-producing tooling (question-bank/exam-authoring — not yet
built anywhere in this codebase) must emit exactly this JSON shape:
`schema_version` (currently must be `1`) and a non-empty, bounded
`test_cases` array of `{"stdin": string, "expected_output": string}`
objects, with no other top-level or per-test-case fields. `internal/bundle`
enforces this strictly (unknown fields, wrong schema version, empty or
oversized `test_cases`, and oversized raw ciphertext are all rejected with a
clear error) rather than silently accepting a malformed bundle and
fanning out garbage or empty test cases.

The format is versioned via `schema_version` specifically so it can evolve
(e.g. adding per-test-case time/memory overrides, file-based I/O, or
multiple expected outputs) without breaking bundles produced under an
earlier version or requiring a lockstep deploy between the bundle producer
and Judge.

Each test case being its own encrypted object means fan-out performs one
KMS encrypt and one storage `Put` per test case per submission — a real but
bounded cost (capped by `maxTestCases`), and one that must be cleaned up on
the storage side if the owning database transaction does not commit (see
`Postgres.Submit`'s orphaned-object cleanup, added alongside this format).
