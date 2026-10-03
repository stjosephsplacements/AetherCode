package telemetry

import (
	"context"
	"crypto/rand"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/trace"
)

var (
	uuidPattern      = regexp.MustCompile(`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`)
	numericIDPattern = regexp.MustCompile(`/\d+(/|$)`)
)

// sanitizePath replaces UUIDs and numeric path segments with {id} to keep
// Prometheus label cardinality bounded.
func sanitizePath(path string) string {
	path = uuidPattern.ReplaceAllString(path, "{id}")
	path = numericIDPattern.ReplaceAllStringFunc(path, func(s string) string {
		if strings.HasSuffix(s, "/") {
			return "/{id}/"
		}
		return "/{id}"
	})
	return path
}

// LoggerWithTrace returns the logger enriched with trace_id and span_id from the
// active OTel span in ctx. If no span is active, the logger is returned unchanged.
func LoggerWithTrace(ctx context.Context, logger *slog.Logger) *slog.Logger {
	span := trace.SpanFromContext(ctx)
	if !span.SpanContext().IsValid() {
		return logger
	}
	sc := span.SpanContext()
	return logger.With(
		slog.String("trace_id", sc.TraceID().String()),
		slog.String("span_id", sc.SpanID().String()),
	)
}

type requestIDKeyType struct{}

var requestIDKey requestIDKeyType

// ContextWithRequestID returns a new context carrying the given request ID.
// Services read this value with RequestIDFromContext or via the httpx wrapper.
func ContextWithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey, id)
}

// RequestIDFromContext retrieves the request ID stored in ctx, or returns an
// empty string if none was set.
func RequestIDFromContext(ctx context.Context) string {
	if id, ok := ctx.Value(requestIDKey).(string); ok {
		return id
	}
	return ""
}

// HTTPMiddleware wraps an http.Handler with:
//   - Request-ID injection and propagation via X-Request-ID header
//   - OTel span creation for distributed tracing
//   - Prometheus request counter and duration histogram
func HTTPMiddleware(serviceName string, next http.Handler) http.Handler {
	otelHandler := otelhttp.NewHandler(next, serviceName)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = newRequestID()
		}
		r = r.WithContext(ContextWithRequestID(r.Context(), requestID))
		w.Header().Set("X-Request-ID", requestID)

		start := time.Now()
		wrapped := &responseWriter{ResponseWriter: w, status: http.StatusOK}
		otelHandler.ServeHTTP(wrapped, r)

		duration := time.Since(start).Seconds()
		status := strconv.Itoa(wrapped.status)
		path := sanitizePath(r.URL.Path)
		httpRequestsTotal.WithLabelValues(r.Method, path, status).Inc()
		httpRequestDuration.WithLabelValues(r.Method, path).Observe(duration)
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
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
