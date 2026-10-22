# ADR-0034: Question pools

- Status: accepted
- Date: 2026-10-20

## Context

The exam app groups questions into slots and gives each student one question
per slot, so neighbours in a lab rarely share a question. Every platform
student received every item of an exam version.

## Decision

**A section may be a pool.** `exam_sections.draw_count` (Assessment migration
`000029`) makes a section give each student `draw_count` of its items; null
keeps today's behaviour. `POST …/sections` accepts `draw_count` (1 to 100).

**The draw is a hash, not a random number.** `assessment.item_drawn` ranks a
section's items by `md5(candidate_id || item_id)` and keeps the first
`draw_count`. Students get different questions, and a student's draw is the
same every time their assignment is snapshotted again (revocation,
re-delivery), with no state to store. Both snapshot builders
(`materialize_candidate` and `enqueue_candidate_assignment_snapshot`) apply it,
so Submission, the paper, grading and results see only the drawn items.

**Every student's total is the same.** Publication refuses a pool with fewer
items than it draws, or whose items have different maximum scores.

## Consequences

- The staff exam builder adds pools and chooses the section for each
  question; the exam's total counts a pool as `draw_count` times its marks.
  Preview and duplicate carry pools.
- The draw is not secret: anyone with the candidate and item ids could
  compute it, but item ids are not shown to students before the exam.
- Similarity and results compare students only on questions they shared.
