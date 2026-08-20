# Observability — Design Spec (Sub-project E)

Date: 2026-08-20
Sub-project: E
Status: active

## Problem

The platform has no request-ID propagation, no distributed tracing, and only two
placeholder Prometheus counters. Diagnosing a production incident requires being
able to follow a request across 4-7 service hops; without trace context, every
incident is a needle-in-a-haystack problem.

## Scope

1. **Request ID middleware**: inject `X-Request-ID` on gateway, propagate
   through all internal calls, include in every log line and error response.
2. **OTel tracing**: instrument every HTTP handler and gRPC call with OpenTelemetry
   spans. Export to OTLP (Jaeger/Tempo in compose; production endpoint from env).
3. **Real Prometheus metrics**: per-service `http_requests_total{method,path,status}`,
   `http_request_duration_seconds{method,path}`, `db_pool_connections{state}`.
4. **Structured log correlation**: include `trace_id` and `span_id` in every
   `slog` log line so logs and traces are joinable.

## Architecture

### libs/pkg/telemetry (extend existing)

Current `telemetry/metrics.go` has only two counters. Extend with:

```go
// Tracer returns the named tracer from the global provider.
func Tracer(name string) trace.Tracer

// HTTPMiddleware wraps an http.Handler with request-ID injection,
// OTel span creation, and Prometheus metric recording.
func HTTPMiddleware(serviceName string, handler http.Handler) http.Handler

// InitProvider initialises the global OTel trace + metric provider
// from environment variables.
func InitProvider(ctx context.Context, serviceName, version string) (func(), error)
```

### libs/pkg/httpx (extend existing)

Add `RequestIDFromContext(ctx)` and `ContextWithRequestID(ctx, id)` helpers.
The gateway generates a new UUID if no `X-Request-ID` header arrives. All
services read and forward it on every outbound call.

### Per-service wiring

Each service's `cmd/server/main.go` calls `telemetry.InitProvider(...)` at
startup, before the HTTP server starts. The deferred shutdown function flushes
spans and metrics on graceful shutdown.

Each service's `NewHandler(...)` wraps the mux with `telemetry.HTTPMiddleware(...)`.

### Docker compose additions

Add to `docker-compose.yml`:
```yaml
  jaeger:
    image: jaegertracing/all-in-one:1.60
    profiles: ["platform"]
    ports:
      - 16686:16686   # Jaeger UI
    environment:
      COLLECTOR_OTLP_ENABLED: "true"
```

### Configuration

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317  (compose default)
OTEL_SERVICE_NAME=<service-name>                    (injected by chart)
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1                         (10% sampling in prod)
```

For local development: `OTEL_TRACES_SAMPLER_ARG=1.0` (100% sampling).

## Files created/modified

| Path | Action |
|---|---|
| `libs/pkg/telemetry/provider.go` | Create — InitProvider, Tracer |
| `libs/pkg/telemetry/middleware.go` | Create — HTTPMiddleware |
| `libs/pkg/telemetry/metrics.go` | Extend — add HTTP + DB pool metrics |
| `libs/pkg/httpx/request_id.go` | Create — RequestIDFromContext, ContextWithRequestID |
| `services/*/cmd/server/main.go` | Add InitProvider + deferred shutdown (11 files) |
| `services/*/internal/adapters/http/handler.go` | Wrap with HTTPMiddleware (11 files) |
| `docker-compose.yml` | Add jaeger service |
| `.env.example` | Add OTEL_* vars |

## Dependencies

```
go.opentelemetry.io/otel v1.x
go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp
go.opentelemetry.io/otel/sdk/trace
go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp
```

Confirm latest stable versions via upstream before pinning.

## Definition of done

- Every HTTP request carries a `X-Request-ID` through all hops.
- Traces appear in Jaeger UI for a full `make dev-up` local run.
- `make build`, `make test`, `make lint` pass.
- `libs/pkg/telemetry/README.md` documents the setup.
