# ADR-0092: SEB quit-token self-service after hand-in

- Status: accepted
- Date: 2026-11-22

## Context

ADR-0022 moved exam lockdown to per-request Browser Exam Key checks. Quit tokens
and attempt-bound SEB sessions remained in the SEB service but were not wired
through the gateway or the web frontend. Students who needed to quit SEB
manually after hand-in depended on invigilators for the launch-file password.

## Decision

1. When a candidate opens the exam screen inside SEB, the client issues one
   lockdown quit session per attempt (`POST .../lockdown-quit-session`). The
   raw quit token is stored only in `sessionStorage` on that device.
2. Launch files quit on `/student?seb=quit`. After submit (or time-up), the
   student dashboard calls `POST .../quit-self` with the quit token. SEB checks
   still apply on gateway-protected routes.
3. Redemption returns the deployment's `SEB_LAUNCH_PASSWORD` only when the
   session is closed with reason `submitted`, `expired`, `revoked`, or
   `cancelled`, and only once (`quit_redeemed_at`). Active sessions never
   receive the password.
4. Lifecycle projection closes `issued` and `active` sessions on submit.

## Consequences

- Students can exit SEB after a legitimate hand-in without staff intervention.
- The quit password is still a deployment secret; it is never stored in the
  database and never appears in logs or audit rows.
- Candidates who clear storage or switch devices after the exam still need an
  invigilator.