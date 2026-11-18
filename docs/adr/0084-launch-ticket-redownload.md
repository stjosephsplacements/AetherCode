# ADR-0084: The SEB launch ticket opens the launch file again after its first download

Status: accepted (2026-11-18). Amends the single-use rule in migration 000017.

## Context
Safe Exam Browser 3.10.3 on Windows, opening a `sebs://` link, sends HEAD, then GET, receives the password-encrypted
`.seb` file, asks the candidate for the exam password and then downloads the link a second time. With a strictly
single-use ticket the second download returned 401 and SEB showed the error as a web page, so one-click launch failed
for everyone. Found by running the real client against production; the smoke test never re-downloads.

## Decision
`seb.consume_launch_ticket` (migration 000019) accepts a ticket repeatedly: the first download must happen within the
original 60 seconds, and the ticket then stays valid for 120 seconds from that first download. It remains bound to its tenant and exam,
is stored only as a SHA-256, and is replaced by the candidate's next ticket. The 120 seconds cover the time a candidate needs to type the
exam password. SEB's HEAD probe is answered by the web app without touching the ticket; that is PR 212 and must be merged with this one.

## Consequences
A copied link works for up to about three minutes instead of once. The file it returns is encrypted with the launch password, which is
given to candidates separately, and the exam still requires the candidate's own login and the Config Key check. If a candidate's SEB cannot
open the link, the signed-in download of the `.seb` file remains the fallback.

Changing `SEB_ALLOW_VM` or `SEB_LAUNCH_PASSWORD` changes the generated Config Key (the password feeds the hashed quit password).
An exam's policy keeps the key saved the last time staff saved it, so after either change each exam must have its SEB policy saved
again; until then its launch file fails the check, and the old key stays accepted. Production keeps both settings fixed and creates
exams afterwards. Reconciling stored keys automatically is a follow-up.
