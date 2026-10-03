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
GATEWAY_SEB_PROTECTED_PREFIXES=[]         # JSON API-prefix array, e.g. ["/api/submission/v1/exams"]
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

For each configured protected prefix Gateway requires
`X-AetherCode-SEB-Tenant-ID`, `X-AetherCode-SEB-Session-ID`, and a nonempty
`X-SafeExamBrowser-ConfigKeyHash`. It calls the private SEB validation API
twice with the original bearer assertion: once for the config key and once for
the optional browser key. Gateway sends only a SHA-256 fingerprint of
non-secret request metadata; it never forwards source code, cookies, or the
bearer assertion as fingerprint input. Config validation must be `matched`;
browser validation must be `matched` or `not_required`. Any parse, network, or
validation error denies the protected request.

The SEB headers are not forwarded to the target service, preventing a backend
from treating caller-controlled headers as an authorization signal.

## Operations

`/healthz`, `/readyz`, and `/metrics` are Gateway-local. Readiness probes every
configured upstream's `/healthz`, so an unreachable dependency removes the
Gateway instance from service.

```sh
go test ./services/gateway/...
```
