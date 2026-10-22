# ADR-0044: Question review before use

- Status: accepted
- Date: 2026-10-21

## Context

Anyone on staff can author a question and publish it into the one global
bank (decision D1), and every college can then put it in an exam. A wrong
expected output or a leaked answer in a published question reaches every
exam that uses it, and published versions are immutable. A second pair of
eyes before publishing is the cheapest control against that.

A college with one author must still be able to publish, so the control is
a deployment setting, not a rule baked into the schema.

## Decision

**Review requests** (Question Bank migration `000019`). A draft version
carries `review_requested_at` and `review_requested_by`.
`POST /v1/question-versions/{id}/request-review` sets them, checks the
expected revision like every other draft edit, and bumps the revision.

**Approval is publishing.** There is no separate approve step. When
`QBANK_REQUIRE_REVIEW=true`, `qbank.publish_question_version` refuses a
version with no review request (conflict) and refuses the requester
(forbidden); anyone else with write access may publish it. The flag is a
parameter of the function, set from the service's configuration, never from
the request. With the flag off (the default) nothing changes.

**An approval covers the revision the reviewer read.** Publishing already
requires the expected revision; every edit of a draft bumps it. A reviewer
who loaded revision N and publishes after an author's edit gets a stale
revision conflict and must read the new content.

**Review queue.** `GET /v1/questions?status=review` lists the latest
drafts of any author that wait for a review, oldest request first.
`GET /v1/review-policy` tells the staff UI whether reviews are required, so
it offers "Ask for a review" or "Publish" accordingly.

## Consequences

- Enabling the flag takes effect for the next publish; drafts that were
  never sent for review must be sent first.
- Four-eyes is by account, not by person: two accounts of one person
  defeat it. Roles stay as they are; any staff member with write access can
  review.
- Rejection is not modelled. A reviewer who finds a problem tells the author
  out of band; the author edits (which bumps the revision) and asks again.
- The model-solution check (ADR-0033) is still advisory.

## Addendum: naming a reviewer (question-bank migration 000021)

A review request may name a reviewer (`reviewer_id`, never the requester). It
is a routing hint: the queue marks the request "For you" for that person and
the editor tells them it was sent to them, but any other member of staff may
still approve. The choice list is the college's staff, shown only to callers
who may list role assignments.
