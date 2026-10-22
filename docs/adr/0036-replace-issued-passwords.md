# ADR-0036: Users replace passwords staff issue

- Status: accepted
- Date: 2026-10-20

## Context

Staff hand out one-time passwords when they import students, reissue a
batch or reset one account. The exam app makes such a user choose their own
password before anything else. Identity had a `must_change` column but never
set or used it, and no way for a signed-in user to change their password.

## Decision

- Passwords written by staff (`ProvisionAccounts`, `SetPasswords`) set
  `password_credentials.must_change`; a password the user chose (reset link,
  change) clears it.
- Login returns `password_change_required` with the token pair.
- `POST /v1/auth/password` (bearer, Identity) checks the current password,
  stores the new one under the usual policy, clears the flag and records
  `identity.password.changed.v1` (failures too). Other sessions stay signed
  in; a staff reissue is the way to end them.
- The web app keeps an `ac_must_change` cookie while the flag is set and its
  request proxy sends every page to `/account/password` until the user saves
  a new password. Everyone can change their password from the account menu.

## Consequences

- Accounts created before this change are not forced to change; their next
  staff reissue or reset will.
- The requirement is enforced in the web app, as in the exam app; API calls
  are not blocked. A user who skips the page with a hand-built request still
  has only their issued password.
