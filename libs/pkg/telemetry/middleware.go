package telemetry

import (
	"context"
	"crypto/rand"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

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
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
