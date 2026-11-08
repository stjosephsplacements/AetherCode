package httpx

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealthHandler(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	recorder := httptest.NewRecorder()

	healthHandler("identity").ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if !strings.Contains(recorder.Body.String(), `"service":"identity"`) {
		t.Fatalf("unexpected body: %s", recorder.Body.String())
	}
}

func TestOperationalHandlerReturnsUnavailableWhenDependencyIsNotReady(t *testing.T) {
	t.Parallel()

	handler := NewOperationalHandler("example", func(context.Context) error {
		return errors.New("database unavailable")
	})
	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
}

// The response never says why a service is unready, but the log does, once per half minute.
func TestReadinessFailureReasonIsLoggedNotReturned(t *testing.T) {
	var logs strings.Builder
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	handler := readinessHandler("demo", func(context.Context) error { return errors.New("consumer retrying: database is down") })
	for range 3 {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/readyz", nil))
		if recorder.Code != http.StatusServiceUnavailable || strings.Contains(recorder.Body.String(), "database is down") {
			t.Fatalf("response = %d %q, want 503 without the reason", recorder.Code, recorder.Body.String())
		}
	}
	if got := strings.Count(logs.String(), "database is down"); got != 1 {
		t.Fatalf("the reason was logged %d times in a row, want once", got)
	}
}
