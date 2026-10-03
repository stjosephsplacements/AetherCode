// Package messaging defines durable event envelopes and NATS connectivity.
package messaging

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/nats-io/nats.go"
)

// Event is the envelope persisted in each service outbox before publication.
type Event struct {
	ID            string          `json:"id"`
	Type          string          `json:"type"`
	SchemaVersion int             `json:"schema_version"`
	AggregateType string          `json:"aggregate_type"`
	AggregateID   string          `json:"aggregate_id"`
	TenantID      string          `json:"tenant_id,omitempty"`
	OccurredAt    time.Time       `json:"occurred_at"`
	Payload       json.RawMessage `json:"payload"`
}

// Validate rejects incomplete or non-versioned events before an outbox write.
func (event Event) Validate() error {
	if strings.TrimSpace(event.ID) == "" || strings.TrimSpace(event.Type) == "" {
		return fmt.Errorf("event id and type are required")
	}
	if event.SchemaVersion <= 0 {
		return fmt.Errorf("event schema version must be positive")
	}
	if strings.TrimSpace(event.AggregateType) == "" || strings.TrimSpace(event.AggregateID) == "" {
		return fmt.Errorf("event aggregate type and id are required")
	}
	if event.OccurredAt.IsZero() || !json.Valid(event.Payload) {
		return fmt.Errorf("event timestamp and JSON payload are required")
	}
	return nil
}

// Connect establishes a named NATS connection. The caller owns Close.
func Connect(ctx context.Context, url, name string) (*nats.Conn, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(url) == "" || strings.TrimSpace(name) == "" {
		return nil, fmt.Errorf("NATS URL and connection name are required")
	}
	return nats.Connect(url, nats.Name(name), nats.Timeout(5*time.Second))
}
