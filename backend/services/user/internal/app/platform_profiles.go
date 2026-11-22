package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/database"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
)

type PlatformProfiles struct {
	pool *pgxpool.Pool
}

type PlatformProfileRow struct {
	StudentID        string          `json:"student_id"`
	PrincipalID      string          `json:"principal_id"`
	EnrollmentNumber string          `json:"enrollment_number"`
	ProfileName      string          `json:"profile_name,omitempty"`
	Platform         string          `json:"platform"`
	Handle           string          `json:"handle"`
	Stats            json.RawMessage `json:"stats"`
	FetchedAt        *string         `json:"fetched_at,omitempty"`
	Status           string          `json:"status"`
	Failure          *string         `json:"failure,omitempty"`
}

type PlatformProfilesPage struct {
	Items   []PlatformProfileRow `json:"items"`
	Summary map[string]int64     `json:"summary"`
}

type ListPlatformProfiles struct {
	TenantID string
	Platform string
	Status   string
	BatchID  string
	Limit    int
	Cursor   string
}

func NewPlatformProfiles(pool *pgxpool.Pool) (*PlatformProfiles, error) {
	if pool == nil {
		return nil, fmt.Errorf("user database pool is required")
	}
	return &PlatformProfiles{pool: pool}, nil
}

func (service *PlatformProfiles) List(contextValue context.Context, capability centralauthz.Capability, command ListPlatformProfiles) (PlatformProfilesPage, error) {
	var batch any
	if command.BatchID != "" {
		batch = command.BatchID
	}
	var raw json.RawMessage
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		return transaction.QueryRow(contextValue, `SELECT users.platform_profiles_list($1, $2, $3, $4, $5, $6)`,
			command.TenantID, nullText(command.Platform), nullText(command.Status), batch, command.Limit, nullText(command.Cursor)).Scan(&raw)
	})
	if err != nil {
		return PlatformProfilesPage{}, translatePlatformProfilesError(err)
	}
	var payload struct {
		Items   []PlatformProfileRow `json:"items"`
		Summary map[string]int64     `json:"summary"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return PlatformProfilesPage{}, fmt.Errorf("decode platform profiles: %w", err)
	}
	return PlatformProfilesPage{Items: payload.Items, Summary: payload.Summary}, nil
}

func (service *PlatformProfiles) RequestSync(contextValue context.Context, capability centralauthz.Capability, tenantID, studentID string) error {
	var student any
	if studentID != "" {
		student = studentID
	}
	return database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		_, err := transaction.Exec(contextValue, `SELECT users.platform_profiles_sync_request($1, $2)`, tenantID, student)
		return translatePlatformProfilesError(err)
	})
}

func translatePlatformProfilesError(err error) error {
	if err == nil {
		return nil
	}
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		switch postgresError.Code {
		case "42501":
			return apperrors.New(apperrors.CodeForbidden, "not allowed")
		case "22023":
			return apperrors.New(apperrors.CodeInvalidArgument, postgresError.Message)
		}
	}
	return err
}

func nullText(value string) any {
	if value == "" {
		return nil
	}
	return value
}
