# ADR-0086: A short session-check cache and OWASP-minimum password hashing

- Status: accepted (2026-11-18); amends the "no positive cache" rule for the User service's session check
- Date: 2026-11-18

## Context
A 100-student exam-morning test showed identity falling over (OOM, then a gateway readiness cascade), and the target is
10,000 students at once. Two costs dominate. Every authorization decision made one introspection call to Identity and
one database lookup (the User service's session check carried no cache so revocation was instant), which at about one
request per student per second is 10,000 identity calls a second after sign-in. And each sign-in or password change ran
Argon2id at 64 MiB, 3 passes, 4 lanes, about 0.1 to 0.25 CPU-seconds and four threads per request.

## Decision
1. **Session-check cache.** The User service may reuse a successful introspection answer for
   `AUTHZ_IDENTITY_INTROSPECTION_CACHE_TTL` (default 0, off; production sets 10 seconds, maximum 1 minute), never past the
   token's own expiry. RFC 7662 section 4 allows caching introspection results. Failures are never cached, concurrent checks of
   one token share one call, entries are keyed by a SHA-256 of the token and the table is bounded. A revoked token therefore stays
   usable for at most the TTL (logout, password reset, MFA change, account disable).
2. **Password hashing.** New hashes use OWASP's recommended minimum Argon2id settings (19 MiB, 2 passes, 1 lane), the same the
   service already used for generated passwords. That is about five times less CPU and a third of the memory per hash and one
   thread. Existing hashes (up to 64 MiB) keep verifying and are not rewritten; a stored hash asking for more than 64 MiB is refused
   before any work is done. Passwords stay at least 12 characters; sign-in is rate limited per IP and per account.
3. **SEB request-check cache.** At exam start the gateway asks the SEB service to check every submission request, and each check was a
   database transaction: with 1000 students the checks took about 3 s, the gateway's timeout, so 43% of start and save requests were
   refused. The SEB service now reuses an allowed answer for `SEB_CHECK_CACHE_TTL` (off by default, 5 s in the chart, at most 1 minute),
   keyed by the candidate, tenant, URL, both hashes and the client IP. Denials and errors are never cached, so a changed policy that
   starts refusing takes effect within the TTL.
4. **Balanced authorization channel.** Every protected service dialled the central authorization service in User through one gRPC
   connection to a ClusterIP address; gRPC does not balance across it, so all authorization calls from all pods queued on one connection
   to one User pod. A 1000-student test showed 2 to 4 s per request with every pod's CPU idle. User now has a headless Service
   (`user-headless`), clients set `AUTHZ_CLIENT_LOAD_BALANCE=round_robin` (DNS resolution, one connection per User pod), and the User gRPC
   server ends connections after a minute (`MaxConnectionAge`) so clients re-resolve and pods added by the autoscaler take traffic.
5. Concurrent Argon2 work stays bounded per process (ADR-0085 follow-up, PR 220).

## Consequences
Revocation takes up to 10 seconds to reach every service instead of being instant; for an exam platform with minutes-long
sessions that is within industry practice for introspection caching. Pushing revocations (NATS) to remove even that window is the
next step if needed. Hash cost per guess for an attacker with a stolen database drops by the same factor as sign-in cost, which is
why the settings are the OWASP minimum rather than lower and why per-account lockout and the 12-character rule matter.
