package database

import (
	"regexp"
	"testing"
)

func TestNewUUIDv7(t *testing.T) {
	identifier, err := NewUUIDv7()
	if err != nil {
		t.Fatalf("NewUUIDv7() error = %v", err)
	}
	if !regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).MatchString(identifier) {
		t.Fatalf("UUIDv7 format = %q", identifier)
	}
}
