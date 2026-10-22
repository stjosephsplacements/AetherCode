# ADR-0026: Exams assigned to a placement department

- Status: accepted
- Date: 2026-10-19

## Context

Every student belongs to one college department and one placement department
(the User service's two-department invariant). Assessment accepted assignment
rules targeting a `placement_department`, but never delivered them: the rule
backfill returned early for that target ("external placement data we don't
have yet"), and the per-student materializer matched only batch and college
department rules. An exam assigned to a placement department was saved and
reached nobody, with no error.

## Decision

- User's `user.student_batch_affiliation.snapshot.v1` also carries
  `placement_department_id`, the student's current placement department.
  `users.student_placement_department` (User migration 000027) reads it under
  the same capabilities as `student_batch_principal`. Placement memberships are
  written only at enrollment and import, which already publish the snapshot.
- Assessment keeps it on the roster (`student_batch_enrollments`, migration
  000027). `materialize_candidate` also matches `placement_department` rules
  against it, so a student who joins receives open placement rules.
  `backfill_from_assignment_rule` handles placement targets, so a new
  placement rule reaches existing students. A snapshot without the field
  keeps the last known department.

## Consequences

- **Upgrade Assessment before User.** Assessment's snapshot decoder rejects
  unknown fields.
- Students affiliated before the upgrade have no placement department in
  Assessment until their next affiliation snapshot. Reissuing or re-setting the
  batch affiliation republishes it.
