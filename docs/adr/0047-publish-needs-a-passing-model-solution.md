# ADR-0047: A coding question is published only after a model solution passes

- Status: accepted
- Date: 2026-10-21

## Context

Model-solution checks (ADR-0033) were advisory. A wrong expected output in a
published question costs every student who meets it a mark, and published
versions are immutable.

## Decision

`qbank.publish_question_version` (Question Bank migration `000020`) refuses a
coding version unless a model check on it is `completed` with verdict
`accepted` (every test, hidden ones included) in at least one language, and
that check ran on the version's current tests. Each check records the
evaluation-bundle checksum it ran on (`bundle_checksum`); replacing the tests
changes the checksum, so earlier checks no longer count. The listing marks each
check `current`. Multiple-choice questions have no code and are exempt. The
rule is always on and applies to approval under ADR-0044 too, since approval is
publishing.

The editor shows the publish and review buttons only once a current passing
check exists, and says why until then. The API answers 409 with "run a model
solution that passes every test before publishing".

## Consequences

- Checks made before this migration have no checksum and do not count; authors
  rerun one.
- Importing a question (ADR-0032) creates a draft that needs its own check.
- Publishing now depends on Judge being up.
- `smoke.py`, `loadtest.py` and the browser spec run a check before publishing.
