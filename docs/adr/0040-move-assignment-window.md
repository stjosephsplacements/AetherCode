# ADR-0040: Moving an assignment's window after publication

- Status: accepted
- Date: 2026-10-20

## Context

After a lab-wide outage the exam app adds time to every running attempt and
pushes the exam window back, so students who could not start yet still can.
The platform's extra time (ADR-0027) moves deadlines of running attempts
only.

## Decision

`POST /v1/tenants/{t}/assignment-rules/{r}/window` (Assessment, write on
`assignment_rules`) with `available_until` calls
`assessment.move_assignment_window` (migration `000032`): the new close must
be after the rule opens, in the future and within 30 days of the opening. The
rule and its non-revoked assignments take the new close, each assignment gets
a new version and is snapshotted again, and an
`assessment.assignment_rule.window_moved.v1` exam event records the change.
Submission then lets students start until the new close (their deadline is
still start plus duration, capped by the close), and SEB keeps the lock on
for the moved window. The staff exam page offers it per assignment row.

## Consequences

- Moving a window does not extend attempts already running; use extra time
  on the live monitor for those.
- Reopening attempts the clock already ended, which the exam app can do, is
  not offered: their answers are graded, and reopening would undo that.
