# ADR-0023: Candidate paper and self endpoints

- Status: accepted
- Date: 2026-10-19

## Context

The web frontend (M5, ADR-0024) found three gaps that kept a student from
sitting an exam through the platform:

- **No paper.** A student could start an attempt but could not read it.
  `Attempt` and `CandidateAssignment` carry only IDs, reading an exam version
  is a staff permission, and question statements live in the Question Bank,
  which has no candidate route. Saved code could not be read back either, so a
  reload or a crashed browser lost the student's work.
- **No "who am I".** The access token carries only `sub`. The frontend could
  not tell a student from staff, or which tenant to put in its URLs.
- **No exam on the dashboard.** Candidate assignments had no title or
  duration, and no `exam_id`, which the `.seb` launch file route needs.

## Decision

**The paper travels with the assignment snapshot and is served by Submission.**

1. Question Bank's internal `ResolvePublishedQuestionVersion` also returns
   `prompt_markdown` (field 10, additive). Migration 000013 adds it to the
   resolve function.
2. Assessment pins the title and statement on the exam item when it is added
   (migration 000026), as it already pins bundles and limits. A published
   question version is immutable, so the copy never drifts. Assignment
   snapshots carry the exam's `title` and `instructions_markdown` and each
   item's `title` and `prompt_markdown`. The candidate's assignment list also
   returns `exam_id`, `title`, `instructions_markdown` and `duration_seconds`.
3. Submission stores them in its projection (migration 000026), keeping the
   snapshot's item order, and serves
   `GET /v1/tenants/{t}/attempts/{id}/paper`. Only the attempt's owner can
   read it, through `get_attempt_paper_for_candidate`. The response includes
   each item's latest saved answer, which the service fetches, checks against
   its checksum and decrypts. It is sent with `Cache-Control: no-store`.

The alternative, a live call from Submission to Assessment and the Question
Bank, was rejected. It needs a new gRPC server in Assessment, new mTLS
identities and new network paths, and it would make Assessment's
availability part of every exam. With the paper in Submission's own database,
an exam keeps running if Assessment or the Question Bank is down.

The paper is reachable only after the student starts the attempt, and is
SEB-locked like every Submission route. Questions are not visible before the
exam starts.

**`GET /user/v1/me` returns the caller's own active roles.** The User service
verifies the gateway's identity assertion with the same verifier its
`Authorize` RPC uses, then reads the caller's active role assignments through
its `authz_reader` connection. It returns `{principal_id, roles, student}`,
where `student.tenant_id` comes from the student's self-scoped role. There is
no resource to authorize: the principal is the one the verified assertion
names, so a caller can only ever see themselves. This matches Identity's
self-read of `/principals/{id}`. Routing it through `Authorize` instead would
have meant new self-scoped policy rules for every staff role.

## Consequences

- **Upgrade Submission before Assessment.** Submission's snapshot decoder
  rejects unknown fields, so it must understand the new fields before
  Assessment emits them. In the single-server stack both are rebuilt and
  restarted together. On a rolling deployment, do Submission first.
- Exam items added before Assessment 000026, and assignments snapshotted
  before Submission 000026, have no statement. The paper names those items
  "Question N" with an empty statement. A projection only updates on a newer
  assignment version, so republish the exam (or reassign it) to fill them.
- Snapshots grow by the size of the statements, roughly 5 KB per question per
  candidate.
- The paper returns decrypted source, the candidate's own, so Submission now
  reads from object storage on a candidate request. A KMS or storage outage
  makes the paper fail rather than return it without code.
- `/me` reflects role changes immediately. The frontend caches it for the
  session (ADR-0024), which affects only navigation.
