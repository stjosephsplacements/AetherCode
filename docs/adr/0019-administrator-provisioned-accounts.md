# ADR-0019: Administrator-provisioned accounts

- Status: accepted
- Date: 2026-10-04

## Context

Colleges run exams for students who have no college email they reliably use.
The exam app (ADR-0016) let an administrator import a batch from CSV with
generated passwords, sign students in by roll number, reissue a lost batch's
passwords, create staff, and enable or disable accounts. The platform had only
self-registration with email verification, and nothing could create an
account for someone else.

Account data is split across two services. Identity owns credentials and is
global; it has no tenant and no central authorization client. User owns
college membership (students, role assignments) and is the central
authorization service.

Bringing the platform up on the campus server also showed that Identity's
`GET`/`DELETE /v1/principals/{id}` and `DELETE /v1/principals/{id}/hard`
checked only that the caller was signed in. Any student could read or delete
any account, including permanently.

## Decision

1. **Usernames.** A principal gains an optional, globally unique, lowercase
   `username` (`^[a-z0-9][a-z0-9._-]{0,63}$`); email becomes optional, and
   every principal keeps at least one of the two. Login takes an
   `identifier`, which is an email or a username. Usernames cannot contain
   `@`, so the two never collide. A student's username is their lowercase
   roll number.
2. **Identity provisions, User decides.** Identity exposes four private
   endpoints on its existing mTLS listener, which trusts only the User
   service's certificate: provision accounts, reissue passwords, set status,
   and discard. They generate 12-character passwords from an unambiguous
   alphabet, hash them with Argon2id, return them once, and audit every
   change with the acting administrator. They make no authorization decision
   of their own. User calls them only after it has authorized the request.
3. **A new `accounts` resource.** A new `accounts` resource on the `user`
   route separates account management from student records. User's SQL
   commands (`import_students`, `grant_staff_role`, `tenant_account_principals`,
   `batch_account_principals`, `existing_enrollment_numbers`) re-check the
   signed `users.accounts` context. A college may manage only principals that
   are its students or staff and hold no role anywhere else, so a college
   administrator can never reset a platform administrator or another
   college's staff.
4. **Ordering.** An import authorizes and validates, then has Identity create
   the accounts, then enrolls them under a second, fresh capability. A
   capability lasts five seconds and is single-use, and 500 Argon2id hashes
   take about four seconds. If enrollment fails, User asks Identity to
   discard (soft-delete) the new accounts so that a retry can reuse their
   usernames. Any invalid row rejects the whole file; roll numbers the
   college already has are skipped. One call imports at most 500 rows.
5. **Identity's principal endpoints are self-only.** `GET` and `DELETE
   /v1/principals/{id}` act only on the caller's own principal. The
   unauthorized hard-delete route is removed until Identity has central
   authorization. Administrators manage accounts through User.

## Consequences

- An administrator can run the exam app's account workflows on the platform.
- Generated passwords exist only in the import, reissue, reset or
  staff-creation response, which is sent with `Cache-Control: no-store`.
  Losing that response means reissuing.
- Roll numbers must fit the username rule. Slashes and spaces are rejected
  with the row number.
- A username is global, so two colleges cannot both have a student `22cs001`.
  The import fails and names the clash. A college-prefixed username scheme
  can be added if this happens in practice.
- Hard-deleting a principal now needs a direct database operation by a
  platform operator.
- `department_user` (faculty) already holds `/*` within its college under the
  existing policy, so faculty can also manage accounts. Narrowing that is a
  policy change for M6.
