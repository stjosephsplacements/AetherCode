# ADR-0020: College staff author the global question bank

- Status: accepted
- Date: 2026-10-04

## Context

Decision D1 in the exam parity plan: anyone on a college's staff can author
questions, and every question goes into one global master bank that every
college uses. Students cannot author.

The question bank is a Global authorization route: its requests carry no
tenant. Two gates allowed only platform roles to author:

1. Central authorization applied college, department and batch assignments
   only to requests for the same tenant, so staff assignments never matched a
   question-bank request.
2. The question bank's local projection set read and write from the platform
   grant alone. A grants snapshot says only that a principal holds *some*
   role in a tenant, so it cannot tell staff from students.

## Decision

1. The `question-bank` route sets `StaffAuthoring`. On that route, and only
   there, a `college_admin` or `department_user` assignment from any college
   applies to a tenant-less request. Mentors and students stay excluded. The
   existing Casbin rows (`college_admin college /* *`,
   `department_user department /* *`) then allow the action. Other Global
   resources, such as creating a college, remain platform-only.
2. A tenant grant in `authz.grants_snapshot.v1` carries `"authoring": true`
   when it comes from one of those two roles. The key is omitted otherwise,
   so every other grant and every consumer that ignores it are unchanged.
   The shared snapshot decoder accepts it only on tenant grants.
3. The question bank's projection, on both the live consumer and the resync
   function, gives global read and write to a platform grant or an authoring
   grant. A grant that never expires outlasts every expiring one.
4. User migration `000025` republishes the snapshot of every current staff
   member once, so existing staff do not wait for an unrelated role change.

## Consequences

- Faculty and college administrators of every college can create, edit,
  publish and archive any question in the shared bank. That is D1's intent.
  Narrower rules, such as authors editing only their own questions, would be
  a later policy change.
- Staff can read every question, including unpublished drafts. Students
  cannot read the bank at all; they see questions only through an exam.
- During an upgrade, a snapshot carrying the new key is rejected by a
  consumer still running the old decoder. The resync protocol repairs it, and
  the single-server stack restarts every service together.
