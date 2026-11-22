# ADR-0081: Placement and integrity, Milestone B

- Status: accepted
- Date: 2026-11-22

## Context

Milestone A shipped talent cards, the live proctor grid and company-pack tagging.
Milestone B adds the practice arena, a constrained SQLite runner for practice,
a post-release Socratic explainer, and (later) keystroke playback.

## Decision

### Practice arena

- Students reach **Arena** from the practice hub: a timed session (default 45
  minutes) over problems tagged `arena` (any value after the colon is ignored).
  Untagged problems stay on the normal practice paths.
- Arena is client-timed only; it does not write exam or attempt records.

### SQLite runner (practice only)

- **SQLite is never offered on test questions.** In practice it runs only when
  the question's tags include `runner:sqlite` or `arena:sql`, and only if
  `sqlite` is in `QBANK_LANGUAGES` (or the default language list once operators
  add sqlite to Judge).
- Judge still sandboxes SQLite; practice uses the existing `question-bank:practice`
  fairness key (ADR-0041).

### Post-release Socratic explainer

- After results are **released**, coding items on the student result screen show
  a short **guided reflection** (rule-based prompts from verdict and per-test
  outcomes). No model call; no data leaves the browser beyond what the result
  API already returns.

### Keystroke playback

- Deferred to a later slice (shared client capture channel with cadence from A).

## Consequences

- Staff tag arena and SQLite practice problems explicitly; mis-tagged SQLite on
  non-sqlite questions is rejected at submit time.
- The Socratic copy is advisory study material, not an official rubric change.