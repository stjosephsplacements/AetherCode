# ADR-0012: Fail-closed Gateway and SEB enforcement boundary

- Status: accepted
- Date: 2026-07-24

## Context

Candidate exam traffic needs a single public edge without making internal
service URLs, Judge control-plane endpoints, or caller-supplied forwarding
headers trusted. SEB validation must apply before protected submissions reach
their target, while revocation and ownership remain enforceable inside each
service's signed RLS transaction.

## Decision

Gateway accepts only `/api/{service}/...` for a fixed platform allow-list and
uses an explicit service-to-absolute-upstream configuration map. Judge is not
on that list. It verifies every protected Ed25519 identity assertion locally,
does not cache a positive result, rejects hop-by-hop and spoofed proxy headers,
and applies a bounded per-instance token bucket after verification. Only
explicit Identity login/lifecycle routes are anonymous. Global rate limits
remain an ingress/WAF responsibility.

Protected SEB prefixes require a tenant ID, session ID, and config-key header.
Gateway creates a SHA-256 fingerprint from non-secret request metadata and
calls private SEB validation twice with the same bearer assertion. A config
result must be `matched`; browser validation must be `matched` or
`not_required`. Errors deny the request. The headers are removed before the
proxied target request.

SEB asks User for a self authorization decision and its security-definer
validation procedure binds `authz.current_context_actor_id()` to
`seb.sessions.candidate_id`. Therefore the central self resource is never an
opaque session ID. Missing, foreign, and invalid sessions receive a generic
denial and return no session metadata. The procedure is replaced in place so
the old app-executable path cannot remain a bypass.

SEB's authorization projection starts not-ready and its RLS authorization
lookup is gated on a manifest-verified, outbox-backed targeted resync. Normal
snapshot consumer/publisher failure starts a new resync; readiness remains
false until the completion manifest matches all applied items.

## Consequences

Platform upstreams must be private and directly reachable only from Gateway or
the service network. Direct client requests to a backend are unsupported and
must be blocked by network policy/ingress configuration; backend central
authorization plus RLS remains mandatory defense in depth.

Gateway adds per-request JWS verification and, for protected exam routes, two
SEB calls. Capacity planning must reserve this latency inside the two-second
submission acceptance budget. A missing NATS/projection-worker configuration
now prevents SEB from starting rather than allowing stale local grants.
