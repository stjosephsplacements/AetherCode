# ADR-0091: Password-reset email through Microsoft Graph, sent by the Identity service

- Status: accepted (2026-11-18)

## Context
`POST /v1/auth/password-reset` created a reset token that only an operator could deliver (`cmd/deliver-reset`), and the
web app had no forgot-password page. Staff and administrators have email addresses on their accounts; students sign in by
roll number and have none, so they keep the staff-assisted reset. The college's mail is Microsoft 365, and Microsoft is
retiring basic-auth SMTP for Exchange Online.

## Decision
The Identity service sends the email itself through Microsoft Graph `sendMail`, using an Entra application's client
credentials (`Mail.Send`, application permission). The delivery bearer is the one it already derives for the operator path, so no
new token type exists. The HTTP response is identical for known and unknown addresses; the repository reports whether an account matched, so
unknown addresses are never mailed. The send is asynchronous: the request enqueues the mail on a bounded in-memory queue (256
slots, 4 workers) owned by the service and returns, and a send failure is logged (Graph's error code only, never the link or
secret), not returned. The queue is drained on shutdown up to the shutdown timeout; when it is full the mail is dropped and
logged, and the user can request again. A crash can lose a queued mail; that is accepted, and no durable outbox is built.
No claim is made that response timing is equal for known and unknown addresses: a matched request does more database work.

Abuse controls: the request limiter (per IP), plus a per-account throttle in the store (one reset token per minute and five per
hour, answered the same and mailing nothing). Locked accounts can reset, as `ResetPassword` already allows. The link carries a
bearer, so `IDENTITY_PUBLIC_BASE_URL` must be https outside development and test (startup fails otherwise). The web reset page
runs without third-party scripts, sends no Referer, is not indexed, and removes the token from the address bar once loaded
(with JavaScript off the token stays in the address and the form still works). The web pages appear only when the frontend has
`PASSWORD_RESET_EMAIL=on`. The web app gets `/auth/forgot-password` and `/auth/reset-password`.

A separate notification worker consuming `identity.password_reset.requested.v1` was rejected for now: it would need Identity's
delivery-token key, which no other service should hold.

## Consequences
Identity needs egress to Microsoft on 443: the chart allows port 443 to public addresses only, because a NetworkPolicy cannot filter by host name; a per-host allowlist needs an egress proxy or a firewall rule. Identity holds the client secret (a Kubernetes Secret
`aethercode-mail`, all four keys or none). Rotating the secret needs a restart. A
mail outage is visible only in logs until an alert exists. Students are unchanged.
