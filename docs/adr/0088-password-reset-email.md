# ADR-0088: Password-reset email through Microsoft Graph, sent by the Identity service

- Status: accepted (2026-11-18)

## Context
`POST /v1/auth/password-reset` created a reset token that only an operator could deliver (`cmd/deliver-reset`), and the
web app had no forgot-password page. Staff and administrators have email addresses on their accounts; students sign in by
roll number and have none, so they keep the staff-assisted reset. The college's mail is Microsoft 365, and Microsoft is
retiring basic-auth SMTP for Exchange Online.

## Decision
The Identity service sends the email itself through Microsoft Graph `sendMail`, using an Entra application's client
credentials (`Mail.Send`, application permission). The delivery bearer is the one it already derives for the operator path, so no
new token type exists. The send runs after the HTTP response and its failure is logged, not returned, which keeps the response
and its timing identical for known and unknown addresses. The repository reports whether an account matched, so unknown addresses
are never mailed. The web app gets `/auth/forgot-password` and `/auth/reset-password`.

A separate notification worker consuming `identity.password_reset.requested.v1` was rejected for now: it would need Identity's
delivery-token key, which no other service should hold.

## Consequences
Identity needs egress to Microsoft on 443 (a chart network-policy rule) and holds the client secret (a Kubernetes Secret
`aethercode-mail`, optional). Rotating the secret needs a restart. The reset request limiter (per IP) is the abuse control; a
mail outage is visible only in logs until an alert exists. Students are unchanged.
