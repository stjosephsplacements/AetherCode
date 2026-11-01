# ADR-0051: Question authoring is a guided flow, and the language list comes from the service

- Status: accepted
- Date: 2026-11-01

## Context

A coding question could be created with details only, then given tests, then
checked with a model solution pasted into a textarea. Nothing in the console led
an author through that order, the details of a saved draft could not be changed,
and the language list was copied into three places in the frontend.

The rule that matters already lives in the question bank: a coding version is
published only after a model solution passes every test, hidden ones included,
on the tests as they are now (ADR-0047). A check needs a saved draft, because it
runs against the encrypted test bundle and records that bundle's checksum.

## Decision

**The console walks an author through the order.** A new question is a wizard:
details, then tests (or options for a multiple-choice question), then a review.
Nothing is saved until the review. Saving creates the draft once, with its tests,
and lands on the workbench for that draft, which shows four stages: details,
test cases, verify, publish. Verify is a Monaco editor with a language picker; a
run goes to every test and the results arrive as Judge finishes. Publish is shown
locked, with the reason, until a passing check exists on the current tests. The
server refuses it as well, so the console adds no new rule: it makes the existing
one visible.

**Holding details and tests in the browser until the first save** is deliberate.
There is no endpoint to edit a draft's title, statement or limits, and saved
tests are encrypted and cannot be read back, so the only free editing is before
the first save. Replacing the tests of a saved draft stays possible and asks for
a new check.

**The question bank serves its languages.** `GET /v1/languages` returns
`{key, name, editor}` entries, from `QBANK_LANGUAGES` or, when unset, the six
languages Judge runs (c, cpp17, java, python3, javascript, go). It authorises as
`read questions/policy`, like `GET /v1/review-policy`, so no policy change is
needed. The console falls back to the same six only on a 404, for the length of a
rolling deploy.

## Consequences

- `QBANK_LANGUAGES` does not make Judge run a language; it only controls what
  authors may offer. It must list keys Judge knows.
- Editing a saved draft's details still means writing the question again. An
  `update draft` endpoint would have to invalidate checks whenever limits or
  languages change; it is not part of this decision.
- Discarding an abandoned draft has no UI yet; its delete semantics need to be
  confirmed first.
- Other screens still name languages from the console's own map
  (`languageName`); moving them to the service list is a follow-up.
