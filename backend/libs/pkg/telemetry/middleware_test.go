package telemetry

import (
	"bufio"
	"net"
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

// A WebSocket upgrade hijacks the connection. The wrapper used to hide that,
// and every upgrade through a service failed with 501 (ADR-0050).
func TestMiddlewareKeepsHijackAndFlush(t *testing.T) {
	t.Parallel()
	seen := make(chan [2]bool, 1)
	server := httptest.NewServer(HTTPMiddleware("test-svc", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hijacker, hijackable := w.(http.Hijacker)
		_, flushable := w.(http.Flusher)
		seen <- [2]bool{hijackable, flushable}
		if !hijackable {
			http.Error(w, "not hijackable", http.StatusNotImplemented)
			return
		}
		conn, _, err := hijacker.Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		_, _ = conn.Write([]byte("HTTP/1.1 101 Switching Protocols\r\n\r\n"))
		_ = conn.Close()
	})))
	defer server.Close()

	conn, err := net.Dial("tcp", server.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()
	if _, err := conn.Write([]byte("GET / HTTP/1.1\r\nHost: test\r\n\r\n")); err != nil {
		t.Fatal(err)
	}
	line, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	if got := <-seen; !got[0] || !got[1] {
		t.Fatalf("writer lost capabilities: hijack=%v flush=%v", got[0], got[1])
	}
	if want := "HTTP/1.1 101"; len(line) < len(want) || line[:len(want)] != want {
		t.Fatalf("status line = %q, want a 101", line)
	}
}
