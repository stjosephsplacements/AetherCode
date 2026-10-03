package database

import (
	"strings"
	"testing"
)

func TestHashRequestBodyRequiresJSONAndIsStable(t *testing.T) {
	hash, err := HashRequestBody([]byte(`{"operation":"create","value":1}`))
	if err != nil {
		t.Fatalf("HashRequestBody() error = %v", err)
	}
	if len(hash) != 64 || hash != strings.ToLower(hash) {
		t.Fatalf("HashRequestBody() = %q, want lowercase SHA-256", hash)
	}
	if _, err := HashRequestBody([]byte("not JSON")); err == nil {
		t.Fatal("HashRequestBody() accepted invalid JSON")
	}
}

func TestNewIdempotencyStoreRejectsUnsafeTable(t *testing.T) {
	if _, err := NewIdempotencyStore("app.idempotency_keys; DROP TABLE users"); err == nil {
		t.Fatal("NewIdempotencyStore() accepted unsafe table name")
	}
	if _, err := NewIdempotencyStore("app.idempotency_keys"); err != nil {
		t.Fatalf("NewIdempotencyStore() error = %v", err)
	}
}
