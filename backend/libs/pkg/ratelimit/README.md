# ratelimit

In-process token bucket rate limiter shared across AetherCode services.

## Purpose

Abuse-prone HTTP and gRPC endpoints (login, registration, password reset,
attempt creation, code-execution admission) each need to throttle a caller
key — client IP, candidate ID, tenant fairness key — without adding an
external dependency. This package was extracted from duplicate
implementations previously maintained separately by the gateway and identity
services; every consumer now shares one token-bucket implementation.

## API

| Function | Purpose |
|---|---|
| `Config{Capacity, RefillPerSecond float64; MaxEntries int; IdleTTL time.Duration}` | Bucket parameters. All fields must be positive. |
| `New(config Config) (*Limiter, error)` | Construct a limiter. Rejects a non-positive configuration. |
| `(*Limiter).Allow(key string, now time.Time) bool` | Consume one token for `key`. A nil limiter or empty key always returns `false`. |

## Bounded memory

`MaxEntries` caps the number of tracked keys so a flood of distinct
principals/IPs cannot grow the process heap without limit. Admission first
evicts idle buckets (older than `IdleTTL`), then the single oldest bucket if
still at capacity. Eviction runs under the same lock as admission, so the
entry cap is invariant under concurrent load.

## Convention across services

Every consumer treats a `nil *ratelimit.Limiter` as "rate limiting disabled"
rather than requiring a non-nil limiter at construction time. This lets each
service wire a limiter from environment-driven burst/rate configuration in
`main.go` while keeping the option to disable it in tests or constrained
environments.

## Testing

`go test ./ratelimit/...` — no database or network required.
