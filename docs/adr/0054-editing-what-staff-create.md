# ADR-0054: Staff can edit what they create, until it is published

- Status: accepted
- Date: 2026-11-01

## Context

Colleges, departments, batches, draft questions, draft exams and students could be
created but mostly not changed. A typo in a department name or an exam title meant
deleting and starting again, and deleting is restricted (ADR-0053).

## Decision

Every editable thing gets a `PATCH`. Only the fields in the body change; a field left
out stays as it is, and at least one field is required.

| Resource | Route | Editable |
| --- | --- | --- |
| College | `PATCH /v1/tenants/{id}` | legal name, display name |
| Placement organisation | `PATCH /v1/placement-organizations/{id}` | legal name |
| Department | `PATCH /v1/tenants/{t}/departments/{id}` | code, name |
| Batch | `PATCH /v1/tenants/{t}/batches/{id}` | code, name, academic year |
| Draft question | `PATCH /v1/question-versions/{id}` | title, statement, difficulty, limits |
| Draft exam | `PATCH /v1/tenants/{t}/exam-versions/{id}` | title, instructions, window, duration |
| Draft exam section | `.../sections/{id}` | title, instructions, time limit (clearable) |
| Draft exam question | `.../sections/{s}/items/{id}` | marks |
| Student | `PATCH /v1/tenants/{t}/students/{id}` | enrolment number, admission date |

**Published work stays immutable.** A published question version and a published
exam version refuse edits. A new draft is the way to change them.

**Concurrency.** Question and exam edits carry the revision the author saw
(`expected_question_version`, `expected_content_version`) and a stale one is a conflict,
like adding and removing sections. Every edit bumps that revision.

**Changing a question's limits makes an earlier model-solution check stale.** The
publish gate matches a passing check to the tests' checksum only, so changing a limit
clears the stored checksum and the author runs the check again.

**Authorised as writes.** An edit uses the same permission as creating that resource,
so no new rule is needed, and every one is recorded in the staff audit log (ADR-0043).

## Not editable on purpose

Student status moves through the account status route, a batch move through the batch
affiliation route, and a student's name through the profile route. They are not
repeated here. A question's category and tags already have their own routes (ADR-0052).

## Consequences

- Nine `PATCH` routes across tenant, question bank, assessment and user, each covered by tests.
- Migrations: question bank `000024`, assessment `000035`.
