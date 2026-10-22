# ADR-0027: Exam-day operations: release, extra time, announcements, live monitor

- Status: accepted
- Date: 2026-10-19

## Context

Roadmap M6 ports the exam app's exam-day controls (`apps/exam-v1` README):
faculty watch a live monitor, post announcements, grant extra time to one
student or everyone, and release results. Students see nothing but
"submitted" until release.

Submission owns attempts, deadlines and score summaries, so these controls
belong there. Its routes were candidate-only: each authorized `attempts`
with the bearer subject as resource and bound rows to the signed actor.

## Decision

**Staff routes authorize on resources a candidate can never hold.** They name
the exam version as resource ID:

| Route | Authorizes |
|---|---|
| `GET /v1/tenants/{t}/exam-versions/{v}/monitor` | read `score_summaries` |
| `PUT /v1/tenants/{t}/exam-versions/{v}/results-release` | write `score_summaries` |
| `POST /v1/tenants/{t}/exam-versions/{v}/extensions` | write `attempt_events` |
| `POST /v1/tenants/{t}/exam-versions/{v}/announcements` | write `attempt_events` |

A student's `self` scope matches only the resource types listed in
`assignmentApplies` (User service), which include neither, so the policy
gives students no path to these capabilities. College administrators and
department staff of the tenant get them through their tenant-wide rules;
mentors may read the monitor but not change anything.

**Each operation is one owner-bound function** (`000028_exam_operations`)
that checks its signed context:

- `get_exam_monitor` returns one row per active assignment of the version,
  with the newest attempt, answered items and the score: the finalized score,
  or the best-so-far score while the attempt runs.
- `set_exam_results_release` records `exam_operations.results_released_at`.
  Releasing again keeps the first time; hiding clears it.
- `extend_attempt_deadlines` adds 1 minute to 4 hours to the deadline of one
  attempt, or of every attempt of the version still in progress (active and
  within its answer grace). It logs `submission.attempt.deadline_extended.v1`
  per attempt and does not bump the attempt version, so the open exam screen
  keeps saving with the version it holds. An attempt that has ended is not
  reopened.
- `post_exam_announcement` stores a message of 1 to 2000 characters.

**Candidates poll and read their own attempt.** `GET .../attempts/{a}/live`
returns the current deadline and the version's announcements; the exam screen
polls it every 15 seconds, moves its timer when staff add time and shows new
announcements. `GET .../attempts/{a}/result` returns `{"released": false}`
until staff release results and the attempt is graded, then the total and
each question's best score. Hidden test details are never part of it.

## Consequences

- Extra time moves deadlines of attempts in progress only. It does not move
  the exam window, so a student who has not started gets no extra time and
  cannot start after the window closes. The exam app also pushes the window
  back and can reopen attempts the clock ended in the last 30 minutes; both
  need Assessment to own a window change and are left for M7.
- Announcements reach students by polling, within 15 seconds, not by push.
- No new event crosses services, so no consumer must be upgraded first.
