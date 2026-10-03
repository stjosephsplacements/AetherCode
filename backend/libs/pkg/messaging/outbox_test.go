package messaging

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
)

func TestOutboxAndInboxStoreRejectUnsafeTableNames(t *testing.T) {
	t.Parallel()
	if _, err := NewOutboxStore(nil, "app.outbox_events"); err == nil {
		t.Fatal("NewOutboxStore accepted a nil pool")
	}
	if _, err := NewInboxStore(nil, "app.inbox_messages"); err == nil {
		t.Fatal("NewInboxStore accepted a nil pool")
	}
	if !qualifiedTablePattern.MatchString("app.outbox_events") {
		t.Fatal("qualified table pattern rejected a valid table")
	}
	if qualifiedTablePattern.MatchString("app.outbox_events; DROP TABLE app.outbox_events") {
		t.Fatal("qualified table pattern accepted SQL injection")
	}
}

func TestPlatformSubjectsAvoidJetStreamAPI(t *testing.T) {
	for _, subject := range platformSubjects {
		token, rest, ok := strings.Cut(subject, ".")
		if !ok || rest != ">" || token == "" || strings.ContainsAny(token, "*>$") {
			t.Fatalf("subject %q must be a literal domain followed by .>", subject)
		}
	}
}

func TestIsEmptyFetch(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"nats timeout", nats.ErrTimeout, true},
		{"fetch deadline", fmt.Errorf("fetch: %w", context.DeadlineExceeded), true},
		{"connection closed", nats.ErrConnectionClosed, false},
	}
	for _, test := range tests {
		if got := isEmptyFetch(test.err); got != test.want {
			t.Errorf("%s: isEmptyFetch = %v, want %v", test.name, got, test.want)
		}
	}
}

func TestEventEncodeKeepsPayloadBytes(t *testing.T) {
	// PostgreSQL's jsonb::text spacing, which producers hash before publishing.
	payload := json.RawMessage(`{"snapshot": {"b": 1, "a": [1, 2]}, "note": "x, y: z"}`)
	encoded, err := Event{
		ID: "01a0ffbe-5ef1-75b0-af24-99c369a40c16", Type: "authz.grants_snapshot.v1", SchemaVersion: 1,
		AggregateType: "principal", AggregateID: "p", OccurredAt: time.Unix(0, 0).UTC(), Payload: payload,
	}.Encode()
	if err != nil {
		t.Fatal(err)
	}
	var decoded Event
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("encoded envelope is not valid JSON: %v", err)
	}
	if !bytes.Equal(decoded.Payload, payload) {
		t.Fatalf("payload bytes changed:\n got %s\nwant %s", decoded.Payload, payload)
	}
	if decoded.Type != "authz.grants_snapshot.v1" || decoded.SchemaVersion != 1 {
		t.Fatalf("envelope fields lost: %+v", decoded)
	}
	if _, err := (Event{Payload: json.RawMessage(`{bad`)}).Encode(); err == nil {
		t.Fatal("invalid payload must be rejected")
	}
}
