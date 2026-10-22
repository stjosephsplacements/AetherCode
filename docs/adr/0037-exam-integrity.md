# ADR-0037: Exam integrity: fullscreen, paste guard and flags

- Status: accepted
- Date: 2026-10-20

## Context

The exam app records when a student leaves the exam window, can require
fullscreen, and can block pasting text from outside the exam; invigilators see
the events as flags. Safe Exam Browser (ADR-0022) locks lab machines, but not
every exam runs in it.

## Decision

- **Settings per exam version** on Submission's `exam_operations`
  (migration `000032`): `require_fullscreen` and `block_external_paste`, set
  with `PUT /v1/tenants/{t}/exam-versions/{v}/integrity` (write on
  `attempt_events`, staff only) and editable during the exam. The candidate's
  `…/live` state returns them, so open exam screens apply a change within 15
  seconds.
- **Events**: `POST /v1/tenants/{t}/attempts/{a}/events` with `kind` `blur`,
  `paste` or `fullscreen_exit` stores a `submission.attempt.integrity.v1`
  attempt event for the candidate's own active attempt, at most 1000 per
  attempt.
- **Exam screen**: leaving the window is reported at most every 3 seconds
  (always); with fullscreen required the screen is covered until the student
  returns to fullscreen, and leaving it is reported; with the paste guard on,
  the editor accepts only text copied inside it and blocks pasting, dropping
  and the context menu's paste. Inside Safe Exam Browser (its user agent)
  focus and fullscreen are not tracked, as in the exam app.
- **Staff**: the live monitor shows a flag count per student and the settings;
  the attempt review lists each event with its time.

## Consequences

- Flags are evidence for an invigilator, not proof: a notification or a
  second monitor also blurs the window.
- A determined student can bypass a browser's fullscreen and paste checks;
  Safe Exam Browser remains the lock for graded lab exams.
