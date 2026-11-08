# libs/pkg

Shared Go libraries consumed by every platform service. Each package has one
responsibility and no knowledge of any particular service's domain.

| Package | Purpose |
|---------|---------|
| `authn` | JWT assertion signing and parsing (Ed25519 keys) |
| `authz` | Capability-based authorization: issue, validate, and central gRPC client |
| `authzprojection` | Durable event-driven projection of authorization grants (resync + snapshot) |
| `buildinfo` | Version string injected at build time, surfaced in /healthz and startup logs |
| `cmd/bootstrap` | First-run administrator provisioning CLI |
| `cmd/migrate` | Database migration runner CLI |
| `cmd/rotate-authz-key` | Authorization key publish/retire CLI |
| `config` | Service and database configuration loading |
| `database` | PostgreSQL pool, tenant transaction, UUID v7, idempotency, soft delete, migration |
| `errors` | Transport-independent typed application errors (codes + causes) |
| `evalbundle` | Evaluation bundle format: build, parse, marshal test cases and unit outputs |
| `grpcmtls` | mTLS gRPC client/server setup with SPIFFE subject validation |
| `httpauth` | HTTP authorization middleware (bearer token → capability decision) |
| `httpx` | HTTP server, strict JSON decode/encode, UUID parsing, enum queries, Problem responses |
| `kms` | Key management interface; `kms/local` implements it with local AES-GCM |
| `logging` | Structured JSON logging setup (`slog.SetDefault`) |
| `messaging` | NATS JetStream producer, pull consumer, outbox, inbox with deduplication |
| `pagination` | Cursor-based pagination parsing and limit validation |
| `ratelimit` | Token-bucket rate limiter per principal or IP |
| `rbac` | Bitfield permission model (256-flag Perms type, BitString serialization) |
| `storage` | Object storage interface; `storage/minio` implements it |
| `telemetry` | OpenTelemetry tracing and HTTP middleware; `telemetry/dbmetrics` for pgx pool metrics |
