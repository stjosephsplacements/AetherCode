package app

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
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

// ViolationList is an attempt's violations, oldest first. Truncated is set when
// the proctor service cut the list to its newest entries.
type ViolationList struct {
	Violations []Violation
	Truncated  bool
}

// ViolationReader reads an attempt's violations from the proctor service.
type ViolationReader interface {
	Violations(ctx context.Context, tenantID, attemptID string) (ViolationList, error)
}

// ProctorEvidence bundles an attempt's violations with its webcam snapshots.
type ProctorEvidence struct {
	AttemptID  string      `json:"attempt_id"`
	Violations []Violation `json:"violations"`
	// Truncated is set when the violation list was cut; snapshots are fully paged.
	Truncated bool       `json:"truncated"`
	Snapshots []Snapshot `json:"snapshots"`
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
	if service.storage == nil {
		return ProctorEvidence{}, apperrors.New(apperrors.CodeUnavailable, "snapshot storage is not configured")
	}
	snapshots, err := service.listAllSnapshots(contextValue, capability, tenantID, attemptID)
	if err != nil {
		return ProctorEvidence{}, err
	}
	violations, err := service.violationReader.Violations(contextValue, tenantID, attemptID)
	if err != nil {
		return ProctorEvidence{}, fmt.Errorf("read proctor violations: %w", err)
	}
	return ProctorEvidence{
		AttemptID:  attemptID,
		Violations: violations.Violations,
		Snapshots:  snapshots,
		Truncated:  violations.Truncated,
	}, nil
}

const snapshotEvidencePageSize = 200

// listAllSnapshots walks keyset pages inside one tenant transaction so a
// single-use capability is not consumed per page.
func (service *Service) listAllSnapshots(contextValue context.Context, capability centralauthz.Capability, tenantID, attemptID string) ([]Snapshot, error) {
	all := make([]Snapshot, 0)
	err := service.inTenant(contextValue, capability, func(transaction pgx.Tx) error {
		command := ListSnapshots{TenantID: tenantID, AttemptID: attemptID, Limit: snapshotEvidencePageSize}
		_, walkErr := walkSnapshotPages(snapshotEvidencePageSize, func(before string) ([]Snapshot, error) {
			command.BeforeID = before
			rows, storeErr := service.store.ListSnapshotKeys(contextValue, transaction, command)
			if storeErr != nil {
				return nil, storeErr
			}
			page := make([]Snapshot, 0, len(rows))
			for _, row := range rows {
				url, presignErr := service.storage.PresignGet(contextValue, row.StorageKey, 15*time.Minute)
				if presignErr != nil {
					return nil, fmt.Errorf("presign snapshot %s: %w", row.ID, presignErr)
				}
				page = append(page, Snapshot{ID: row.ID, CapturedAt: row.CapturedAt, URL: url})
			}
			all = append(all, page...)
			return page, nil
		})
		return walkErr
	})
	return all, err
}

// walkSnapshotPages fetches keyset pages until a short page. before is empty on the first call.
func walkSnapshotPages(pageSize int, fetch func(before string) ([]Snapshot, error)) ([]Snapshot, error) {
	var all []Snapshot
	var before string
	for {
		batch, err := fetch(before)
		if err != nil {
			return nil, err
		}
		all = append(all, batch...)
		if len(batch) < pageSize {
			return all, nil
		}
		before = batch[len(batch)-1].ID
	}
}
