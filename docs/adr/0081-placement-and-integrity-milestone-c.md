# ADR-0081: Placement and integrity, Milestone C

- Status: accepted
- Date: 2026-11-22

## Context

Milestone B added practice arena and tutoring affordances. Milestone C adds
richer plagiarism review for staff and placement-scoped consortium drives with
leaderboards. Concept heatmaps remain deferred.

## Decision

### AST similarity visualiser (MVP)

- Staff **similarity compare** keeps side-by-side source. A new **token alignment**
  panel reuses the Submission winnowing tokeniser (ADR-0031) to highlight shared
  unusual tokens between two programs. It does not replace the MOSS score.
- Optional `GET .../similarity/align` returns token streams and match indices for
  the compare screen; no new protobuf.

### Consortium drives and leaderboards (placement-scoped first)

- Analytics holds `analytics.consortium_drives` keyed by `placement_department_id`
  (global track). A drive has a title, window (`opens_at`, `closes_at`), and
  metric `placement_score` (latest score from `placement_student_rollups` on
  the track).
- Placement staff with existing placement analytics write create drives;
  students and staff read the leaderboard while the window is open.
- Cross-college aggregation is limited to students on the same placement
  department; there is no billing or public marketplace.

## Consequences

- Full AST parse trees and concept heatmaps wait for a later milestone.
- Multi-metric drives and external college federation beyond placement departments
  need another ADR.