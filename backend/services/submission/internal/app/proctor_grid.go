package app

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
)

// defaultMaxViolations is the red line for an exam whose policy sets none.
const defaultMaxViolations = 5

// GridRow is the raw proctor-grid row before severity and presigning.
type GridRow struct {
	AttemptID      string
	CandidateID    string
	StartedAt      *time.Time
	SnapshotID     *string
	CapturedAt     *time.Time
	StorageKey     *string
	ViolationTotal int
	ViolationKinds map[string]int
	MaxViolations  *int
}

// GridTile is one active attempt on the invigilator's grid.
type GridTile struct {
	AttemptID      string         `json:"attempt_id"`
	CandidateID    string         `json:"candidate_id"`
	StartedAt      *time.Time     `json:"started_at,omitempty"`
	SnapshotID     *string        `json:"snapshot_id,omitempty"`
	CapturedAt     *time.Time     `json:"captured_at,omitempty"`
	SnapshotURL    *string        `json:"snapshot_url,omitempty"`
	ViolationTotal int            `json:"violation_total"`
	ViolationKinds map[string]int `json:"violation_kinds"`
	Severity       string         `json:"severity"`
}

// GridSeverity is red at the exam's limit, amber from half of it or on a
// prohibited device, else green. The colour is decided here, never by the client.
func GridSeverity(total int, kinds map[string]int, maxViolations *int) string {
	limit := defaultMaxViolations
	if maxViolations != nil && *maxViolations > 0 {
		limit = *maxViolations
	}
	switch {
	case total >= limit:
		return "red"
	case total*2 >= limit || kinds["phone_detected"] > 0:
		return "amber"
	}
	return "green"
}

// GetProctorGrid lists an exam version's active attempts with their newest
// snapshot and violation severity. The caller authorized proctor_evidence.
func (service *Service) GetProctorGrid(contextValue context.Context, capability centralauthz.Capability, command ExamVersionCommand) ([]GridTile, error) {
	if err := command.validate(); err != nil {
		return nil, err
	}
	if service.storage == nil {
		return nil, apperrors.New(apperrors.CodeUnavailable, "snapshot storage is not configured")
	}
	var rows []GridRow
	if err := service.inTenant(contextValue, capability, func(transaction pgx.Tx) error {
		var storeErr error
		rows, storeErr = service.store.ProctorGrid(contextValue, transaction, command)
		return storeErr
	}); err != nil {
		return nil, err
	}
	tiles := make([]GridTile, 0, len(rows))
	for _, row := range rows {
		tile := GridTile{
			AttemptID: row.AttemptID, CandidateID: row.CandidateID, StartedAt: row.StartedAt,
			SnapshotID: row.SnapshotID, CapturedAt: row.CapturedAt, ViolationTotal: row.ViolationTotal,
			ViolationKinds: row.ViolationKinds, Severity: GridSeverity(row.ViolationTotal, row.ViolationKinds, row.MaxViolations),
		}
		if tile.ViolationKinds == nil {
			tile.ViolationKinds = map[string]int{}
		}
		if row.StorageKey != nil {
			url, err := service.storage.PresignGet(contextValue, *row.StorageKey, 5*time.Minute)
			if err != nil {
				return nil, fmt.Errorf("presign grid snapshot %s: %w", row.AttemptID, err)
			}
			tile.SnapshotURL = &url
		}
		tiles = append(tiles, tile)
	}
	return tiles, nil
}

// DecodeKinds reads the jsonb kind-count object the grid query returns.
func DecodeKinds(raw []byte) (map[string]int, error) {
	kinds := map[string]int{}
	if len(raw) == 0 {
		return kinds, nil
	}
	if err := json.Unmarshal(raw, &kinds); err != nil {
		return nil, fmt.Errorf("decode violation kinds: %w", err)
	}
	return kinds, nil
}
