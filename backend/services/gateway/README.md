# Gateway

Gateway is AetherCode's stateless, fail-closed public HTTP edge. It owns no
application database and never routes to the private Judge control plane.

`/api/{service}/...` is accepted only for these fixed service names:
`identity`, `tenant`, `user`, `question-bank`, `assessment`, `submission`,
`seb`, `notification`, and `analytics`. The service segment is stripped before
the configured absolute upstream URL is called. `judge` and unconfigured
services are unreachable.

All routes except these exact public Identity routes require a freshly verified
Ed25519 identity assertion: `POST /v1/auth/register`, `verify-email`, `login`,
`mfa/verify-login`, `refresh`, `logout`, `password-reset`, and
`password-reset/complete`. Gateway has no development bypass or positive token
cache. It preserves `Authorization`, `Idempotency-Key`, `traceparent`, and
`tracestate`, rejects hop-by-hop/spoofed forwarding headers, and writes its own
canonical forwarding headers.

## Required configuration

```text
GATEWAY_IDENTITY_ASSERTION_ISSUER
GATEWAY_IDENTITY_ASSERTION_AUDIENCE
GATEWAY_IDENTITY_ASSERTION_PUBLIC_KEYS   # JSON object: key ID -> base64 Ed25519 key
GATEWAY_UPSTREAMS                        # JSON object: service -> absolute HTTP(S) URL
```

Example `GATEWAY_UPSTREAMS`:

```json
{
  "identity": "https://identity.platform.svc.cluster.local",
  "submission": "https://submission.platform.svc.cluster.local",
  "seb": "https://seb.platform.svc.cluster.local"
}
```

Upstreams cannot contain credentials, a query, or a fragment. They must be
private service endpoints reachable only from Gateway/the platform service
network; direct client access to a backend is not a supported trust path.
Services still validate their own central authorization decision and RLS
capability, so Gateway does not become an authorization boundary of record.

Optional controls, all validated at startup:

```text
GATEWAY_TRUSTED_PROXY_CIDRS=[]            # JSON CIDR array; only these peers may supply X-Forwarded-For
GATEWAY_SEB_PROTECTED_PREFIXES=[]         # JSON API-prefix array, e.g. ["/api/submission/v1/tenants"]
GATEWAY_SEB_PUBLIC_ORIGIN=                # required with protected prefixes, e.g. https://exam.example.edu
GATEWAY_RATE_LIMIT_CAPACITY=60
GATEWAY_RATE_LIMIT_REFILL_PER_SECOND=10
GATEWAY_RATE_LIMIT_MAX_ENTRIES=100000
GATEWAY_RATE_LIMIT_IDLE_TTL=10m
GATEWAY_REQUEST_TIMEOUT=30s
GATEWAY_SEB_VALIDATION_TIMEOUT=3s
```

The token-bucket limiter is per Gateway instance and keyed by verified
principal (or by a trustworthy source IP for anonymous public Identity calls).
Ingress/WAF must enforce the complementary global quota; the in-memory bucket
is intentionally bounded and is not a distributed rate-limit authority.

## SEB enforcement

ADR-0022. Every protected prefix must be tenant-scoped
(`/api/<service>/v1/tenants/<tenant_id>/...`). For a request under one,
Gateway rebuilds the absolute URL the browser requested from
`GATEWAY_SEB_PUBLIC_ORIGIN` and the raw request target (never from forwarded
headers), and posts it with the optional `X-SafeExamBrowser-RequestHash` and
`X-SafeExamBrowser-ConfigKeyHash` values to SEB's private
`/v1/tenants/<tenant_id>/request-checks`, carrying the original bearer
assertion. SEB answers `not_required` when the bearer candidate sits no locked
exam, `matched` when a header equals sha256(URL + an accepted key), and
`missing`/`mismatched` otherwise. Only the first two forward the request; any
parse, network, or check error denies it. The reverse proxy in front of
Gateway must pass the request target through unchanged, because that is what
SEB hashed.

The SEB headers are not forwarded to the target service, preventing a backend
from treating caller-controlled headers as an authorization signal.

## Realtime (ADR-0050)

`GET /api/realtime` is a WebSocket for the staff console; `GET /api/realtime/services`
returns the same service-health snapshot over HTTP (bearer token, administrators only).

```
GATEWAY_REALTIME_ORIGINS=https://exam.example.edu   # browser origins allowed to connect; empty disables the socket
GATEWAY_REALTIME_ACCESS_COOKIE=ac_access             # the session cookie holding the access token
GATEWAY_REALTIME_NATS_URL=nats://nats:4222           # optional; without it only service health is pushed
GATEWAY_REALTIME_HEALTH_INTERVAL=5s                  # how often each upstream's /healthz is probed
GATEWAY_SERVICE_DESCRIPTIONS={"user":"Accounts, students and permissions"}  # optional, keys must be upstreams
```

A connection must send an allowed `Origin`, a valid session cookie and `?tenant=`
naming a tenant where the caller holds a staff role (`GET /v1/me` on the user
service decides). It receives `{"type":"changed","topic":"attempts"|"grading"|"activity"}`
hints for that tenant only (`activity` is the staff audit log), never event payloads; college and platform
administrators also receive `{"type":"health",...}` snapshots. The socket closes
with code 4401 when the session expires. Each principal may hold 8 connections.

The ingress must send `/api/realtime` straight to the gateway with WebSocket
upgrades and long read timeouts; the Helm chart and `deploy/single-server` do.

## Operations

`/healthz`, `/readyz`, and `/metrics` are Gateway-local. Readiness probes every
configured upstream's `/healthz`, so an unreachable dependency removes the
Gateway instance from service.

```sh
go test ./services/gateway/...
```
