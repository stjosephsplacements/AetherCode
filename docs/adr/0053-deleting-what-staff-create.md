# ADR-0053: Staff can delete what they create, only while nothing depends on it, and every delete is logged

- Status: accepted
- Date: 2026-11-01

## Context

The console could create questions, exams, departments and batches but not remove
them. The backend already had soft-delete routes, and they never worked: the
authorizer refused the `delete` action, the signed capability said `.delete` where
the databases check `.write`, the question bank's app role has no table access,
the SQL named `updated_at` columns that do not exist, and `assignment_rules` had
no `deleted_at` for the exam cascade. Nothing stopped a published question or
exam from being deleted either, which would break exams that pin them.

## Decision

**Delete is a real action, issued as a write.** `Authorize` accepts `read`,
`write` and `delete`. A delete is authorised by the same rule as a write on that
resource, and the capability sent to the database is `<service>.write`, which is
what the SQL functions check.

**Every delete is logged with its verb.** `users.staff_audit` gains `action`
(`write` or `delete`), migration `000032`. The audit page and the dashboard say
"Deleted batch (tenant)" for these. Every delete also needs a reason, up to 500
characters, which is stored on the row.

**The database refuses deletes that would break something**, so no client can
get around it:

- A question can be deleted only if it was never published. Exams pin published
  versions. Question bank `000023`.
- An exam can be deleted only while it has no version past draft. Assessment `000034`.
- A department can be deleted only when it has no live batches. Tenant `000012`.
- A batch with students cannot be deleted. Students live in another database, so
  the BFF checks `GET /students?batch_id=` first.

Removing a question or an empty section from a draft exam is an edit, not a delete,
and needs no reason.

## Not offered

Students, colleges and placement organisations have no delete button. Removing
them reaches into results, attempts and other tenants' data. Turning an account
off is the supported way out, and it can be undone.

## Consequences

- Eight places that could not be deleted before now can, with the rules above
  enforced in SQL and covered by integration tests.
- Rolling back `000032` drops the verb column, so old pods keep working against
  a 6-argument wrapper of `record_staff_action`.
