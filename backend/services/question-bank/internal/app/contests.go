package app

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/database"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
)

type SaveCollegeContest struct {
	Title       string
	Description string
	StartsAt    time.Time
	EndsAt      time.Time
	QuestionIDs []string
}

func (service *Service) ListCollegeContests(ctx context.Context, capability centralauthz.Capability, tenantID string) (json.RawMessage, error) {
	return service.contestJSON(ctx, capability, func(tx pgx.Tx) (json.RawMessage, error) {
		return service.store.ListCollegeContests(ctx, tx, tenantID)
	})
}

func (service *Service) SaveCollegeContest(ctx context.Context, capability centralauthz.Capability, tenantID string, command SaveCollegeContest) (json.RawMessage, error) {
	if command.Title == "" || len(command.QuestionIDs) == 0 || !command.EndsAt.After(command.StartsAt) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "contest title, problems and window are required")
	}
	for _, questionID := range command.QuestionIDs {
		if !isUUID(questionID) {
			return nil, apperrors.New(apperrors.CodeInvalidArgument, "every problem id must be a uuid")
		}
	}
	id := uuid.NewString()
	return service.contestJSON(ctx, capability, func(tx pgx.Tx) (json.RawMessage, error) {
		return service.store.SaveCollegeContest(ctx, tx, tenantID, id, command.Title, command.Description, command.StartsAt, command.EndsAt, command.QuestionIDs)
	})
}

func (service *Service) RegisterCollegeContest(ctx context.Context, capability centralauthz.Capability, tenantID, contestID string) (json.RawMessage, error) {
	if !isUUID(contestID) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "contest identifier is invalid")
	}
	return service.contestJSON(ctx, capability, func(tx pgx.Tx) (json.RawMessage, error) {
		return service.store.RegisterCollegeContest(ctx, tx, tenantID, contestID)
	})
}

func (service *Service) CollegeContestLeaderboard(ctx context.Context, capability centralauthz.Capability, tenantID, contestID string) (json.RawMessage, error) {
	if !isUUID(contestID) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "contest identifier is invalid")
	}
	return service.contestJSON(ctx, capability, func(tx pgx.Tx) (json.RawMessage, error) {
		return service.store.CollegeContestLeaderboard(ctx, tx, tenantID, contestID)
	})
}

func (service *Service) contestJSON(ctx context.Context, capability centralauthz.Capability, read func(pgx.Tx) (json.RawMessage, error)) (json.RawMessage, error) {
	var raw json.RawMessage
	err := database.WithTenantTx(ctx, service.pool, capability, func(tx pgx.Tx) error {
		var storeErr error
		raw, storeErr = read(tx)
		return storeErr
	})
	return raw, err
}
