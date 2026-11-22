# ADR-0093: Multiple-choice practice

- Status: accepted
- Date: 2026-11-22

## Context

ADR-0041 limited practice to coding questions. Staff need practice-audience
MCQs with the same submit-and-learn loop, and students should see per-option
explanations after submit (ADR-0058), which exams withhold until results
release.

## Decision

Question Bank migration `000033` lets `practice_version` resolve mcq versions.
`start_practice_mcq_submission` grades synchronously (all-or-nothing, same rule
as Submission mcq scoring) and stores the selection on `practice_submissions`.
`get_practice_submission` returns `correct_choices` and `choice_explanations`
only after a completed submit.

The web UI adds an MCQ workspace, catalogue type filters, and routes mcq
problems by `kind` on `GET .../practice/questions/{id}`.

## Consequences

- Practice mcq exposes explanations to every student once they submit; staff
  should not move exam-only secrets into practice mcq lightly.
- MCQ practice does not consume Judge capacity.