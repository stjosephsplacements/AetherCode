package telemetry

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMiddlewareInjectsRequestID(t *testing.T) {
	t.Parallel()
	handler := HTTPMiddleware("test-svc", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := RequestIDFromContext(r.Context())
		if id == "" {
			t.Error("request ID not injected into context")
		}
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Header().Get("X-Request-ID") == "" {
		t.Error("X-Request-ID not set in response header")
	}
}

func TestMiddlewarePreservesIncomingRequestID(t *testing.T) {
	t.Parallel()
	const incoming = "test-request-id-123"
	handler := HTTPMiddleware("test-svc", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("X-Request-ID", incoming)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("X-Request-ID"); got != incoming {
		t.Errorf("X-Request-ID = %q, want %q", got, incoming)
	}
}

func TestPathSanitization(t *testing.T) {
	t.Parallel()
	cases := []struct {
		input string
		want  string
	}{
		{"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c221001/students", "/v1/tenants/{id}/students"},
		{"/v1/questions/42/versions", "/v1/questions/{id}/versions"},
		{"/v1/health", "/v1/health"},
	}
	for _, c := range cases {
		if got := sanitizePath(c.input); got != c.want {
			t.Errorf("sanitizePath(%q) = %q, want %q", c.input, got, c.want)
		}
	}
}
