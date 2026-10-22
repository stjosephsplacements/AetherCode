# ADR-0043: Staff operations views: analytics, grading queue, audit log, roles

- Status: accepted
- Date: 2026-10-20

## Context

The old AetherCode app and v1 give administrators four things the platform
lacked:

- results analytics across exams and departments;
- a view of the judge's queue;
- an audit log of staff actions;
- a way to see and change who holds which staff role.

Analytics already holds graded results. Most staff actions emit no event,
and the judge has no public API.

## Decision

**Analytics page.** `/staff/analytics` reads Analytics' graded exam results
for every published exam. It maps students to departments and batches
through the User service. It shows per-exam averages, highest and lowest
scores and pass rates (pass is 40% of the marks), breakdowns by department
and batch, the top 10 students, and the students below the pass mark. No new
backend.

**Grading queue.** Submission migration `000035` adds
`get_grading_queue(tenant)`, readable with `score_summaries` like the live
monitor. It counts graded evaluations and sample runs that are waiting or
running and the oldest wait, and reports last-hour completions, failures and
median and p95 time to verdict. System status shows it.

**Audit log.** The User service authorizes every protected request in the
platform. User migration `000029` therefore records every staff write
decision there, allowed or refused, in `users.staff_audit`: who, which
service, resource and ID, which college, and when. A decision counts as
staff when the actor holds any role other than a student's self scope, so
students' autosaves are not recorded. Read decisions are not recorded.

- **Appending:** the read-only authorization role can only append, through
  `record_staff_action`.
- **Failures:** recording is best effort, so an audit failure is logged and
  never blocks a request.
- **Retention:** entries are kept for 400 days.
- **Reading:** college administrators read the log with `staff_audit`. The
  policy check makes it administrators-only, however broad a department's
  wildcard is.

The page turns service and resource into plain words, such as "Gave extra
time or posted an announcement".

**Names.** Identity's private, mTLS-only `POST
/v1/internal/accounts/describe` returns sign-in name, display name and
status for up to 500 principals. The User service's `POST
/v1/tenants/{t}/accounts/describe` first keeps only that college's accounts
(`tenant_readable_principals`, under a read capability), then asks Identity.

**Roles editor.** Staff accounts lists every staff member with their roles,
using the existing role-assignment and mentor APIs. Administrators can grant
or revoke the college administrator, faculty-of-a-department and
mentor-of-batches roles. They can make someone a mentor of many batches at
once, which also records the mentor assignment. Password reset and sign-in
on/off reuse the student actions.

## Consequences

- The audit log describes intent (an authorized write on a resource), not
  the request body or whether the service then succeeded. Refused attempts
  are visible, which matters for security review.
- The question bank is global, so its writes carry no college. Those
  entries are stored without a tenant and do not appear in a college's log.
- Every staff write adds one small insert to the authorization path.
