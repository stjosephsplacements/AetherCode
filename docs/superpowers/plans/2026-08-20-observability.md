# Observability Implementation Plan (Sub-project E)

> **Spec:** `docs/superpowers/specs/2026-08-20-observability-design.md`

**Goal:** Add request-ID propagation, OpenTelemetry tracing, and real Prometheus metrics across all 11 services.

## Global Constraints
- Every HTTP request carries a `X-Request-ID` through all hops
- OTel trace IDs appear in every slog log line (`trace_id`, `span_id` fields)
- `make build`, `make test`, `make lint` all pass
- No service breaks when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset (graceful no-op)
- Dependencies pinned to current stable versions (verify via proxy.golang.org)

---

## Task 1: Extend libs/pkg/telemetry

**Files:**
- Create: `libs/pkg/telemetry/provider.go`
- Create: `libs/pkg/telemetry/middleware.go`
- Modify: `libs/pkg/telemetry/metrics.go`
- Create: `libs/pkg/httpx/request_id.go`

### Step 1: Add OTel dependencies to libs/pkg/go.mod

```bash
cd libs/pkg
export PATH="$HOME/.local/go/bin:$HOME/go/bin:$PATH"
mkdir -p ~/.cache/aethercode-tmp && export TMPDIR=$HOME/.cache/aethercode-tmp GOTMPDIR=$HOME/.cache/aethercode-tmp
go get go.opentelemetry.io/otel@latest
go get go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp@latest
go get go.opentelemetry.io/otel/sdk/trace@latest
go get go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp@latest
go get go.opentelemetry.io/otel/trace@latest
go mod tidy
```

Record the versions installed.

### Step 2: Write provider.go

```go
package telemetry

import (
    "context"
    "os"

    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
    "go.opentelemetry.io/otel/propagation"
    sdktrace "go.opentelemetry.io/otel/sdk/trace"
    semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
    "go.opentelemetry.io/otel/sdk/resource"
    "go.opentelemetry.io/otel/trace"
)

// InitProvider initialises the global OTel trace provider. If
// OTEL_EXPORTER_OTLP_ENDPOINT is empty the provider uses a no-op exporter
// so services start cleanly without a collector.
// Returns a shutdown function that must be called on graceful shutdown.
func InitProvider(ctx context.Context, serviceName, version string) (func(context.Context), error) {
    res, err := resource.New(ctx,
        resource.WithAttributes(
            semconv.ServiceName(serviceName),
            semconv.ServiceVersion(version),
        ),
    )
    if err != nil {
        return nil, fmt.Errorf("create otel resource: %w", err)
    }

    var exporter sdktrace.SpanExporter
    if endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"); endpoint != "" {
        exporter, err = otlptracehttp.New(ctx)
        if err != nil {
            return nil, fmt.Errorf("create otlp exporter: %w", err)
        }
    } else {
        exporter = &noopExporter{}
    }

    sampler := sdktrace.ParentBased(sdktrace.TraceIDRatioBased(samplerRatio()))

    provider := sdktrace.NewTracerProvider(
        sdktrace.WithBatcher(exporter),
        sdktrace.WithResource(res),
        sdktrace.WithSampler(sampler),
    )

    otel.SetTracerProvider(provider)
    otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
        propagation.TraceContext{},
        propagation.Baggage{},
    ))

    return func(shutdownCtx context.Context) {
        _ = provider.Shutdown(shutdownCtx)
    }, nil
}

// Tracer returns a tracer from the global provider.
func Tracer(name string) trace.Tracer {
    return otel.Tracer(name)
}

func samplerRatio() float64 {
    // Respect OTEL_TRACES_SAMPLER_ARG if set, default 0.1
    if s := os.Getenv("OTEL_TRACES_SAMPLER_ARG"); s != "" {
        if r, err := strconv.ParseFloat(s, 64); err == nil && r >= 0 && r <= 1 {
            return r
        }
    }
    return 0.1
}

type noopExporter struct{}
func (n *noopExporter) ExportSpans(_ context.Context, _ []sdktrace.ReadOnlySpan) error { return nil }
func (n *noopExporter) Shutdown(_ context.Context) error { return nil }
```

Add `"fmt"`, `"os"`, `"strconv"` to imports.

### Step 3: Write middleware.go

```go
package telemetry

import (
    "net/http"
    "strconv"
    "time"

    "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
    "github.com/aethercode/aethercode/libs/pkg/httpx"
)

// HTTPMiddleware wraps an http.Handler with:
//   - OTel span creation
//   - Request-ID injection/propagation
//   - Prometheus request metrics
func HTTPMiddleware(serviceName string, next http.Handler) http.Handler {
    // OTel instrumentation
    otelHandler := otelhttp.NewHandler(next, serviceName)

    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // Inject or forward X-Request-ID
        requestID := r.Header.Get("X-Request-ID")
        if requestID == "" {
            requestID = newRequestID()
        }
        r = r.WithContext(httpx.ContextWithRequestID(r.Context(), requestID))
        w.Header().Set("X-Request-ID", requestID)

        // Track metrics
        start := time.Now()
        wrapped := &responseWriter{ResponseWriter: w, status: http.StatusOK}
        otelHandler.ServeHTTP(wrapped, r)

        duration := time.Since(start).Seconds()
        status := strconv.Itoa(wrapped.status)
        httpRequestsTotal.WithLabelValues(r.Method, r.URL.Path, status).Inc()
        httpRequestDuration.WithLabelValues(r.Method, r.URL.Path).Observe(duration)
    })
}

type responseWriter struct {
    http.ResponseWriter
    status int
}

func (rw *responseWriter) WriteHeader(code int) {
    rw.status = code
    rw.ResponseWriter.WriteHeader(code)
}

func newRequestID() string {
    // Uses crypto/rand UUID — no external dependency
    b := make([]byte, 16)
    _, _ = rand.Read(b)
    return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
```

### Step 4: Update metrics.go

Replace the two placeholder counters with real HTTP and DB pool metrics:

```go
var (
    httpRequestsTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
        Name: "http_requests_total",
        Help: "Total number of HTTP requests",
    }, []string{"method", "path", "status"})

    httpRequestDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
        Name:    "http_request_duration_seconds",
        Help:    "HTTP request duration",
        Buckets: prometheus.DefBuckets,
    }, []string{"method", "path"})
)

func init() {
    prometheus.MustRegister(httpRequestsTotal, httpRequestDuration)
}
```

### Step 5: Write libs/pkg/httpx/request_id.go

```go
package httpx

import "context"

type contextKey int
const requestIDKey contextKey = iota

func ContextWithRequestID(ctx context.Context, requestID string) context.Context {
    return context.WithValue(ctx, requestIDKey, requestID)
}

func RequestIDFromContext(ctx context.Context) string {
    if id, ok := ctx.Value(requestIDKey).(string); ok {
        return id
    }
    return ""
}
```

### Step 6: Test and commit

```bash
cd /home/shreesh/Documents/AlgoQX
export PATH="$HOME/.local/go/bin:$HOME/go/bin:$PATH"
mkdir -p ~/.cache/aethercode-tmp && export TMPDIR=$HOME/.cache/aethercode-tmp GOTMPDIR=$HOME/.cache/aethercode-tmp
make build && make lint
git add libs/pkg/
git commit -m "feat: add OTel provider, HTTP middleware, and request-ID to telemetry package"
```

---

## Task 2: Wire telemetry into all 11 service servers

For each service in `services/{gateway,identity,tenant,user,question-bank,assessment,submission,judge,seb,notification,analytics}`:

1. In `cmd/server/main.go`, add after the config load:
   ```go
   shutdown, err := telemetry.InitProvider(ctx, "<service-name>", "0.1.0")
   if err != nil {
       logger.Error("failed to init telemetry", "error", err)
   } else {
       defer shutdown(ctx)
   }
   ```

2. In `internal/adapters/http/handler.go` or wherever `NewHandler` returns the mux, wrap with:
   ```go
   return telemetry.HTTPMiddleware("<service-name>", mux)
   ```
   
   Or if `NewHandler` returns `*http.ServeMux` directly, wrap at the `httpx.ListenAndServe` call site.

3. Add `"github.com/aethercode/aethercode/libs/pkg/telemetry"` to imports in each file.

Do NOT add `import "crypto/rand"` to individual services — it's in the telemetry package.

### Step: Add Jaeger to docker-compose.yml

Append to the `services:` section under the `platform` profile:

```yaml
  jaeger:
    image: jaegertracing/all-in-one:1.60
    profiles: ["platform"]
    ports:
      - "127.0.0.1:16686:16686"
      - "127.0.0.1:4318:4318"
    environment:
      COLLECTOR_OTLP_ENABLED: "true"
```

Add to `.env.example`:
```
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_TRACES_SAMPLER_ARG=1.0
```

### Step: Full build and lint

```bash
make build && make test && make lint
```

### Step: Commit

```bash
git add services/ docker-compose.yml .env.example
git commit -m "feat: wire OTel tracing and request-ID into all 11 platform services"
```

---

## Completion checklist

- [ ] `make build` passes after telemetry changes
- [ ] Every service starts normally with `OTEL_EXPORTER_OTLP_ENDPOINT` unset
- [ ] `make lint` passes (0 issues)
- [ ] Jaeger UI available at localhost:16686 when dev stack is up
- [ ] `libs/pkg/telemetry/README.md` documents the setup and configuration
