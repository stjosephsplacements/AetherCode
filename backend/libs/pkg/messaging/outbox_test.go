package messaging

import "testing"

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
