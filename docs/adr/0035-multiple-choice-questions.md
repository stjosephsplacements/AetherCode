# ADR-0035: Multiple-choice questions

- Status: accepted
- Date: 2026-10-20

## Context

The exam app mixes coding and multiple-choice questions. Its rules: a
question has single or multiple correct options, each student sees the
options in an order of their own, and marking is all-or-nothing (the
selection must equal the correct set). The platform only had coding
questions, graded by Judge.

## Decision

**Question Bank.** A version is `coding` or `mcq` (migration `000017`).
`PUT /v1/question-versions/{id}/choices` makes a draft multiple-choice with 2
to 10 options, the indexes of the correct ones and whether several may be
chosen. An mcq version needs no tests or languages to publish. The internal
resolve contract gains `kind`, `choices`, `correct_choices` and
`multiple_choice` (proto fields 11 to 14, additive).

**Assessment.** An exam item is `coding` (bundles, limits) or `mcq` (options
and key; `add_exam_mcq_item`, migration `000030`). Both snapshot builders
carry the kind, options and key to Submission. The key never goes to a
candidate.

**Submission.** Item projections store the kind, options and key (migration
`000031`). `PUT /v1/tenants/{t}/attempts/{a}/choices/{item}` saves a
selection (`choice_answers`) while the attempt is open; the database checks
the indexes and that a single-answer question gets at most one. Code can
never be saved to an mcq item. The paper lists an mcq item's options ordered
by `md5(attempt || item || index)`, each with its authored index, plus the
saved selection; it never carries the key. `attempt_item_scores` scores an
mcq item its maximum when the selection equals the key, else 0, so results,
the monitor, reviews and grading treat both kinds alike. End test and time-up
grade at once when only choices were answered, with no Judge work.

**The maximum is every item given.** Grading used to sum the maximum of the
items the candidate answered, so skipping a question raised the percentage,
and an attempt with nothing evaluated could not be graded. The maximum is now
the sum over all of the candidate's items (`calculation_version` 4).

## Consequences

- Upgrade order: Submission (it decodes the new snapshot fields strictly)
  before Assessment; Question Bank before Assessment (resolve fields).
- Partial credit and negative marking are not supported, as in the exam app.
- Scores recorded before this change keep their old maximum; only attempts
  graded afterwards use the corrected one.
