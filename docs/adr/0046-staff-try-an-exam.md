# ADR-0046: Staff try an exam as a student

- Status: accepted
- Date: 2026-10-21

## Context

Faculty want to sit an exam the way a student does before it opens: the
real screen, a running timer, Run and Submit against the real tests. The
read-only preview (ADR-0020) shows the paper only. The roadmap assumed this
needed preview attempts in Submission: a flag on attempts, and exclusions
from results, the monitor, the similarity report, the CSV export, the grading
queue, analytics events, SEB and notifications. Every one of those readers
would have to learn the flag, in a grading path that runs real exams.

## Decision

**A preview is an ordinary exam taken by one person.** "Try this exam" on a
published exam's page, in the frontend only:

1. copies the exam (the same copy as Duplicate: questions, marks, pools,
   instructions and duration) under the title
   `[Preview] <title>`, open from 20 seconds ago for the duration plus ten
   minutes;
2. publishes the copy;
3. creates a `student`-target assignment rule for the caller's principal and
   materializes it directly, which the Assessment service already supports;
4. opens a lobby for that assignment, whose Start button is the students'.

The caller then starts an attempt through the normal candidate routes. They
are authorized as staff of the college (a college administrator or
department user passes the `attempts` routes by tenant), and Submission
binds the attempt to them as the candidate.

Nothing changes in any service: the real exam has no extra attempts, its
results, monitor and similarity report are untouched, and Safe Exam Browser
settings are not copied, so the copy needs no lab lock.

**Copies stay out of the way.** The title prefix is a reserved word:
`listExams` drops those exams, so the exam list, the calendar, the overview
and the analytics page never show them, and duplicating an exam under a
`[Preview]` title is refused. A copy is reachable by its URL, where the
caller reads their result.

## Consequences

- Each try leaves one exam, one rule and one assignment behind. There is no
  cleanup; Assessment has no hard delete for exams, and the volume is a
  handful per author.
- The tester's attempt appears in the college-wide totals the analytics
  service keeps from events (attempts started and graded), because those
  count facts, not exam titles. The analytics page, which lists exams, does
  not show them.
- A tester who is a mentor cannot try an exam: mentors cannot write to
  candidate routes.
- This path is exercised by `smoke.py` ("Staff try an exam as a student")
  and has not been run on the campus stack yet.
