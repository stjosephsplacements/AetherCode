package database

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// OutboxEvent is the common shape persisted in each service-owned outbox.
type OutboxEvent struct {
	EventID       string
	AggregateType string
	AggregateID   string
	TenantID      string
	EventType     string
	SchemaVersion int
	Payload       json.RawMessage
	OccurredAt    time.Time
}

// Validate enforces the minimum durable-event invariants before persistence.
func (event OutboxEvent) Validate() error {
	if strings.TrimSpace(event.EventID) == "" || strings.TrimSpace(event.EventType) == "" {
		return fmt.Errorf("outbox event id and type are required")
	}
	if strings.TrimSpace(event.AggregateType) == "" || strings.TrimSpace(event.AggregateID) == "" {
		return fmt.Errorf("outbox aggregate is required")
	}
	if event.SchemaVersion <= 0 || event.OccurredAt.IsZero() || !json.Valid(event.Payload) {
		return fmt.Errorf("outbox schema version, timestamp, and JSON payload are required")
	}
	return nil
}
