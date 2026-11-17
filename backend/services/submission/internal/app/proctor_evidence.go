package app

import (
	"context"
	"fmt"
	"time"

	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
)

// Violation is one proctor detection recorded for an attempt.
type Violation struct {
	ID         string    `json:"id"`
	SnapshotID string    `json:"snapshot_id"`
	Kind       string    `json:"kind"`
	Confidence float64   `json:"confidence"`
	Details    string    `json:"details"`
	DetectedAt time.Time `json:"detected_at"`
}

// ViolationReader reads an attempt's violations from the proctor service.
type ViolationReader interface {
	Violations(ctx context.Context, tenantID, attemptID string) ([]Violation, error)
}

// ProctorEvidence bundles an attempt's violations with its webcam snapshots.
type ProctorEvidence struct {
	AttemptID  string      `json:"attempt_id"`
	Violations []Violation `json:"violations"`
	Snapshots  []Snapshot  `json:"snapshots"`
}

// WithViolationReader enables the evidence export. Call before serving traffic.
func (service *Service) WithViolationReader(reader ViolationReader) {
	service.violationReader = reader
}

// GetProctorEvidence assembles the evidence for staff holding the proctor
// evidence permission; the caller has already authorized the capability.
func (service *Service) GetProctorEvidence(contextValue context.Context, capability centralauthz.Capability, tenantID, attemptID string) (ProctorEvidence, error) {
	tenantID, attemptID = normalizeUUID(tenantID), normalizeUUID(attemptID)
	if !isUUID(tenantID) || !isUUID(attemptID) {
		return ProctorEvidence{}, apperrors.New(apperrors.CodeInvalidArgument, "tenant ID and attempt ID are required")
	}
	if service.violationReader == nil {
		return ProctorEvidence{}, apperrors.New(apperrors.CodeUnavailable, "proctor evidence is not configured")
	}
	snapshots, err := service.ListSnapshots(contextValue, capability, ListSnapshots{TenantID: tenantID, AttemptID: attemptID, Limit: 200})
	if err != nil {
		return ProctorEvidence{}, err
	}
	violations, err := service.violationReader.Violations(contextValue, tenantID, attemptID)
	if err != nil {
		return ProctorEvidence{}, fmt.Errorf("read proctor violations: %w", err)
	}
	return ProctorEvidence{AttemptID: attemptID, Violations: violations, Snapshots: snapshots}, nil
}
