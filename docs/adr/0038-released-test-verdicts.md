# ADR-0038: Released results show test verdicts

- Status: accepted
- Date: 2026-10-20

## Context

After release the exam app shows each question's per-test verdicts, hidden
tests by number only. Our released result (ADR-0027) showed per-question
scores.

## Decision

`get_attempt_result_for_candidate` (Submission migration `000033`) adds to
each item its kind and `tests`: the verdict of every test in the item's best
completed evaluation (highest score, newest on ties), numbered from 1. No
input, output or timing is returned, so hidden tests stay hidden. The student
result page shows them as passed or failed chips per question.

## Consequences

- A student learns which hidden tests failed, by number, only after staff
  release results, as in the exam app.
