# ADR-0030: Lab networks on the exam lockdown policy

- Status: accepted
- Date: 2026-10-19

## Context

The exam app can limit an exam to the lab's networks: a student outside them
cannot start it. The platform locks exams to Safe Exam Browser (ADR-0022): the
SEB service keeps one policy per exam, and Gateway asks it about every
candidate request to Submission.

## Decision

**Networks belong to the exam's lockdown policy.** `seb.exam_policies` gains
`allowed_networks` (up to 50 CIDR prefixes; single addresses are stored as
/32 or /128). They are independent of the SEB keys: an exam may require the
lab network, Safe Exam Browser, or both.

**Every request is checked, not only the start.** Gateway sends the client
address it already trusts (its peer, or `X-Forwarded-For` from a configured
proxy) as `client_ip` with each SEB request check. While the candidate has an
open assignment (the window plus five minutes) to an exam with networks, the
five-argument `seb.check_exam_request` returns `network_refused` for an
address outside them, or an unknown one. Otherwise it answers as before. Gateway
refuses such a request with 403 and the message "this exam can only be taken
from the college lab network".

## Consequences

- Behind Cloudflare the client address is the lab's public address
  (`CF-Connecting-IP`), so staff enter the lab's public address or range,
  not its private one.
- SEB must be upgraded before Gateway: SEB's request decoder rejects the new
  `client_ip` field until it knows it.
- A student who leaves the lab mid-exam can no longer save, run or submit;
  their saved code is still graded at time-up.
