# ADR-0057: A student directory the staff console can search, filter and act on

- Status: proposed
- Date: 2026-11-02

## Context

The Students page (see the console in `frontend/src/app/staff/students`) now filters, sorts,
exports and acts on many students at once. It is held back by what the services return:

- A student record carries a roll number and a status. Name, email and username come from a
  second call (`POST /v1/tenants/{t}/accounts/describe`), and a student's batch, department and
  mentor are not on the record at all. The page fetches one list per batch to learn the batch.
- There is no phone number anywhere.
- There is no way to ask "who still has the password we gave them", "who joined this month" or
  "who has never signed in". The data exists in identity (`password_credentials.must_change`,
  `changed_at`, `principals.created_at`, `last_authenticated_at`) but is not exposed.
- Everything is filtered in the browser after loading up to 5,000 rows per batch.
- Bulk actions are N calls from the web server, with N audit rows and no single outcome.

The reference product (`siva0990/finalized-codepro`) offers all of these on its students page:
phone, mentor, password status (default or changed), join date filters, and bulk actions.

## Decision

Four additions, in the order they can ship. Each is independent of the next.

### 1. Richer account summaries (identity, no new table except one column)

`POST /v1/tenants/{t}/accounts/describe` adds, per account:

| Field | Source |
| --- | --- |
| `created_at` | `identity.principals.created_at` |
| `last_authenticated_at` | `identity.principals.last_authenticated_at` |
| `password_state` | `temporary` when `password_credentials.must_change`, else `set` |
| `password_changed_at` | `password_credentials.changed_at` |
| `phone` | new `identity.principals.phone` |

`phone` is a nullable column with a length and character check (digits, spaces, `+`, `-`,
`(`, `)`; 6 to 20 characters). Existing rows stay null. The summary reads one `LEFT JOIN`
on `password_credentials`, so the query stays a primary key lookup.

An account edit route, `PATCH /v1/tenants/{t}/accounts/{principal_id}`, changes `display_name`,
`email` and `phone`. Only the fields sent change (the ADR-0054 rule). It is authorised as a
`user.write` on that college's account, goes through the staff audit log (ADR-0043), and an
email change clears `email_verified_at`. A student cannot call it for anyone, including themselves.

### 2. A roster read (user service)

`GET /v1/tenants/{t}/students/roster` returns one page of students with what a table needs, so
the console makes one call per college instead of one per batch.

Query: `batch_id`, `department_id`, `placement_department_id`, `status`, `q` (roll number or
profile name, prefix and substring), `sort` (`enrollment_number` or `name`), `order`, `limit`
(default 50, max 200), `cursor`.

Each item: the student fields, `batch_id`, `batch_name`, `department_id`, `mentor_principal_ids`
(from `mentor_batch_assignments`, active only) and `profile_name` (from `users.profiles`).
The response carries `total` for the filtered set, computed with the same predicate.

It reads through the existing row-level-security policies, so a mentor still sees only their
batches and a department user only their department. No policy changes; the roster is a
join over tables the caller can already read. Keyset pagination on `(sort key, id)`.

### 3. Server-side filters on account state

Password state, join date and last sign-in live in identity, the roster in the user service,
and the two databases stay separate. Two options were weighed.

- **Query identity from the roster.** Rejected: a filter has to join across services for every
  page, and a page of 50 would need a lookup of every candidate, not 50.
- **Project the state into the user service.** Chosen. Identity already publishes account
  events through the outbox; the user service consumes them into
  `users.account_state_projections (principal_id, status, password_state, password_changed_at,
  created_at, last_authenticated_at)`, the same shape as the tenant and assessment projections.
  The roster joins that table and gains `password_state`, `joined_from`, `joined_to`, and
  `signed_in` (`never` or `ever`) filters.

`last_authenticated_at` changes on every sign-in, which would flood the outbox. It is projected
at most once per principal per hour (identity skips the event when the stored value is newer
than an hour), so "never signed in" is exact and "last seen" is accurate to the hour.

Until the projection ships, the console keeps filtering on the describe fields in the browser
for rosters up to 5,000, which is where it is today.

### 4. Bulk account actions as one call

`POST /v1/tenants/{t}/accounts/bulk-status` (`principal_ids`, `status`) and
`POST /v1/tenants/{t}/accounts/bulk-password` (`principal_ids`, returns the new passwords once).
Both take at most 500 ids, require an `Idempotency-Key`, run in one transaction per call, and
write a single audit entry with the count plus one per principal. A principal outside the
college is an error for the whole call, not a skipped row, so a bad selection cannot half apply.
The web server's current loop of single calls is replaced by these.

## Authorisation and tenancy

- Every new read and write is scoped to one college by the capability, as the existing routes are.
- The phone number is personal data. It is returned only to callers who can already read the
  account summary, never to students about other students, and never appears in logs or the
  audit record (the audit row keeps the field name changed, not the value).
- Platform administrators reach several colleges the same way as elsewhere: the web server
  calls each college and merges (ADR-0055). There is no cross-college SQL.

## Migrations

- identity `000019`: `principals.phone` plus its check constraint.
- user `000035`: `account_state_projections`, its RLS policy (read by `user.read`), and the
  inbox table for the events.
- Both are additive and reversible; the down migrations drop what they add.

## Not in this ADR

The other pages in the reference product (users list, queue operations, blogs, contests,
hackathons, open source, roles, branding) were not compared yet. Each gets its own ADR if
a gap is found.

## Consequences

- The Students console can drop its per-batch fan-out and its 5,000 row ceiling.
- A new projection means a backfill: on first deploy a one-off job replays current account
  state, then events keep it current.
- Phone numbers become stored personal data and fall under the existing deletion and export
  routines for accounts.
- Tests: identity repository tests for the summary join and the phone check, handler tests for
  the edit route's authorisation, user service integration tests for roster filters and keyset
  paging under RLS (mentor, department user, college admin), and a projection test that replays
  events out of order.
