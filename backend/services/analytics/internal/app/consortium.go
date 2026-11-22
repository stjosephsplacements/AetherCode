package app

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/database"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
)

// ConsortiumDrive is a placement-scoped leaderboard window (ADR-0081 C).
type ConsortiumDrive struct {
	ID                    string    `json:"id"`
	PlacementDepartmentID string    `json:"placement_department_id"`
	Title                 string    `json:"title"`
	Metric                string    `json:"metric"`
	OpensAt               time.Time `json:"opens_at"`
	ClosesAt              time.Time `json:"closes_at"`
	CreatedAt             time.Time `json:"created_at"`
}

type ConsortiumLeaderboardEntry struct {
	TenantID   string  `json:"tenant_id"`
	StudentID  string  `json:"student_id"`
	Score      *string `json:"score"`
	ActivityAt *string `json:"activity_at"`
}

// CreateConsortiumDrive opens a new placement-scoped drive.
func (service *Service) CreateConsortiumDrive(ctx context.Context, capability centralauthz.Capability, placementDepartmentID, title string, opensAt, closesAt time.Time) (string, error) {
	if !validID(placementDepartmentID) || title == "" || !opensAt.Before(closesAt) {
		return "", invalid("consortium drive fields are invalid")
	}
	var id string
	err := database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		return transaction.QueryRow(ctx, `SELECT analytics.create_consortium_drive($1, $2, $3, $4)`,
			placementDepartmentID, title, opensAt, closesAt).Scan(&id)
	})
	return id, err
}

// ListConsortiumDrives returns drives for one placement track.
func (service *Service) ListConsortiumDrives(ctx context.Context, capability centralauthz.Capability, placementDepartmentID string) ([]ConsortiumDrive, error) {
	if !validID(placementDepartmentID) {
		return nil, invalid("placement department identifier is invalid")
	}
	var raw json.RawMessage
	err := database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		return transaction.QueryRow(ctx, `SELECT analytics.list_consortium_drives($1)`, placementDepartmentID).Scan(&raw)
	})
	if err != nil {
		return nil, err
	}
	var drives []ConsortiumDrive
	if err := json.Unmarshal(raw, &drives); err != nil {
		return nil, apperrors.New(apperrors.CodeUnavailable, "consortium drive list is malformed")
	}
	return drives, nil
}

// ConsortiumLeaderboard ranks students on a drive from placement rollups.
func (service *Service) ConsortiumLeaderboard(ctx context.Context, capability centralauthz.Capability, driveID string, limit int) ([]ConsortiumLeaderboardEntry, error) {
	if !validID(driveID) {
		return nil, invalid("drive identifier is invalid")
	}
	var raw json.RawMessage
	err := database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		return transaction.QueryRow(ctx, `SELECT analytics.consortium_drive_leaderboard($1, $2)`, driveID, normalizedLimit(limit)).Scan(&raw)
	})
	if err != nil {
		return nil, err
	}
	var board []ConsortiumLeaderboardEntry
	if err := json.Unmarshal(raw, &board); err != nil {
		return nil, apperrors.New(apperrors.CodeUnavailable, "leaderboard is malformed")
	}
	return board, nil
}