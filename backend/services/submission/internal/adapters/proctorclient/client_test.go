package proctorclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestViolations(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer secret" || request.URL.Query().Get("attempt_id") != "a" || request.URL.Query().Get("tenant_id") != "t" {
			writer.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = writer.Write([]byte(`{"violations":[{"id":"1","snapshot_id":"s","kind":"face_missing","confidence":0.9,"details":"d","detected_at":"2026-01-01T00:00:00Z"}]}`))
	}))
	defer server.Close()

	client, err := New(server.URL, "secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	got, err := client.Violations(context.Background(), "t", "a")
	if err != nil || len(got) != 1 || got[0].Kind != "face_missing" {
		t.Fatalf("Violations = %+v, %v", got, err)
	}
	bad, _ := New(server.URL, "wrong", time.Second)
	if _, err := bad.Violations(context.Background(), "t", "a"); err == nil {
		t.Fatal("expected an error for a rejected token")
	}
	if _, err := New("ftp://x", "secret", time.Second); err == nil {
		t.Fatal("expected an error for a non-http URL")
	}
}
