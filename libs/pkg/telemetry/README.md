# telemetry

Provides OpenTelemetry distributed tracing, Prometheus metrics, request-ID
propagation, and HTTP middleware for all AetherCode services.

---

## Purpose

- **Request ID propagation** — generates or forwards an `X-Request-ID` header on
  every inbound HTTP request and stores the value in `context.Context` so it can
  be read anywhere in the call stack.
- **OTel tracing** — initialises a global trace provider backed by an OTLP/HTTP
  exporter. When the collector endpoint is not configured, a no-op provider is
  used so services start cleanly without one.
- **Prometheus metrics** — exposes `http_requests_total` (counter) and
  `http_request_duration_seconds` (histogram) labelled by method, sanitised
  path, and status code. DB connection-pool metrics are available via the
  `telemetry/dbmetrics` sub-package, which is kept separate so services
  without a DB (e.g. gateway) do not transitively import pgxpool.

---

## API

| Symbol | Description |
|---|---|
| `InitProvider(ctx, service, version)` | Initialise the global OTel trace provider. Returns a shutdown func that must be called on graceful shutdown. |
| `Tracer(name)` | Return a tracer from the global OTel provider. |
| `HTTPMiddleware(service, next)` | Wrap an `http.Handler` with request-ID injection, OTel span creation, and Prometheus recording. |
| `dbmetrics.Register(service, pool)` | (**sub-package** `telemetry/dbmetrics`) Register a `pgxpool.Pool` with Prometheus so connection totals, idle, and in-use gauges are exported. Import only in services that have a DB pool. |
| `ContextWithRequestID(ctx, id)` | Store a request ID in a context. |
| `RequestIDFromContext(ctx)` | Retrieve the request ID from a context; returns `""` if absent. |
| `LoggerWithTrace(ctx, logger)` | Return a `*slog.Logger` enriched with `trace_id` and `span_id` from the active OTel span in ctx. |

---

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | _(empty)_ | OTLP collector endpoint, e.g. `http://localhost:4318`. When empty, tracing is a no-op. |
| `OTEL_TRACES_SAMPLER_ARG` | `0.1` | Sampling ratio in [0, 1]. |

---

## How to run

Start the full local stack (includes Jaeger all-in-one) with:

```
make dev-up
```

Jaeger UI is available at `http://localhost:16686`.

---

## How to test

```
go test ./telemetry/...
```

Run from the `libs/pkg` directory or from the repo root via `make test`.
