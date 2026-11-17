// Package violation applies the proctor service's threshold-breach events by
// submitting the attempt (ADR-0080).
package violation

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/google/uuid"

	"github.com/stjosephsplacements/AetherCode/libs/pkg/messaging"
)

const (
	// EventType is also the JetStream subject.
	EventType = "proctor.violation.threshold"
	// Reason is recorded on the attempt's submitted event.
	Reason = "proctor_violation_threshold_breach"
)

// Submitter closes one open attempt and reports whether it did. It is
// idempotent, so redelivery needs no inbox.
type Submitter interface {
	SubmitForViolation(ctx context.Context, attemptID, reason string) (bool, error)
}

type breach struct {
	AttemptID      string `json:"attempt_id"`
	ViolationCount int    `json:"violation_count"`
}

// Handler returns the consumer handler for EventType.
func Handler(submitter Submitter, logger *slog.Logger) messaging.EventHandler {
	return func(ctx context.Context, event messaging.Event) error {
		var payload breach
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return messaging.Permanent(fmt.Errorf("decode violation threshold payload: %w", err))
		}
		if _, err := uuid.Parse(payload.AttemptID); err != nil || payload.ViolationCount < 1 {
			return messaging.Permanent(fmt.Errorf("violation threshold payload is invalid"))
		}
		submitted, err := submitter.SubmitForViolation(ctx, payload.AttemptID, Reason)
		if err != nil {
			return fmt.Errorf("submit attempt %s for violations: %w", payload.AttemptID, err)
		}
		logger.InfoContext(ctx, "proctor violation threshold applied",
			"attempt_id", payload.AttemptID, "violation_count", payload.ViolationCount, "submitted", submitted)
		return nil
	}
}
