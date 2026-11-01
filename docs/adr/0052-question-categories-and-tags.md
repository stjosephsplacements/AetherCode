# ADR-0052: Questions are filed by category, told apart by difficulty, and described by tags

- Status: accepted
- Date: 2026-11-01

## Context

The question bank was one flat list. Authors could not group questions as Arrays,
Strings or DP, and a question's tags lived on its versions: they could be set
only while a version was a draft, and a published version is immutable, so a
published question could never be re-tagged without publishing again.

## Decision

**Three levels, one meaning each.** A question belongs to exactly one *category*
(Arrays, Strings, DP). Inside a category, questions are told apart by
*difficulty*, which a version already carries. *Tags* describe the question in
more detail (two-pointers, hash-map). Multiple-choice questions use all three
exactly as coding ones do.

**Category and tags belong to the question, not to a version.** They are
classification, not content, so changing them never needs a new version and is
allowed on a published question: `PUT /v1/questions/{id}/category` and
`PUT /v1/questions/{id}/tags`. The question bank migration (`000022`) adds
`qbank.categories`, `qbank.questions.category_id` and `qbank.question_tags`.

**Every question has a category.** `category_id` is `NOT NULL` with a built-in
*Uncategorised* category as its default. The migration files every existing
question there, and a question created without a category (the exam-app import,
`smoke.py`, an older pod) lands there too. Deleting a category files its
questions under another one, or under Uncategorised. Uncategorised itself cannot
be renamed or deleted.

**Tags move with the question.** The migration gives each question the tags of
its newest version (not the union of all of them, so a tag a later version
dropped does not return). The old `question_version_tags` table stays, no longer
written, until a later contract migration drops it. `PUT
/v1/question-versions/{id}/tags` and the `tags` field of a create payload keep
working: they now set the question's tags, and a version payload that names no
tags leaves them alone rather than clearing them.

**Who may do what.** Any author may add a category (the same name in any letter
case returns the existing one). Renaming, merging and deleting re-file every
college's questions, so only college and platform administrators may. The
policy table cannot express that: `college_admin` and `department_user` carry
the same rights on the global bank. So there are two resources, both with the
ordinary write action: `categories` (open to authors) and `category_management`
(a rule in the User service's `assignmentApplies`, beside the existing
`question_exports` one).

**Rollout without a gap.** Every new column has a default and every old SQL
function signature still works (`create_question` gains a 15-argument overload
and keeps the 14-argument one), so pods on the previous release keep running
while this one rolls out.

## Consequences

- The question bank API gains `GET/POST /v1/categories`, `PATCH/DELETE
  /v1/categories/{id}`, `PUT /v1/questions/{id}/category`, `PUT
  /v1/questions/{id}/tags` and `GET /v1/tags`; question responses carry
  `category_id` and `category`.
- The User service lists two more question-bank resources and one more
  administrator-only rule.
- Exports and imports (ADR-0032) do not carry a category; imported questions
  arrive in Uncategorised.
- Rolling back drops category and any tag changed since: the down migration
  restores the version-level functions exactly, and `question_version_tags` is
  as it was before.
