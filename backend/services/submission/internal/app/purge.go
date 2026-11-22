package app

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/database"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
)

type PurgeCodeRuns struct {
	TenantID  string
	AttemptID string
	ActorID   string
	Reason    string
}

type PurgeCodeRunsResult struct {
	PurgedRuns  int64 `json:"purged_runs"`
	PurgedUnits int64 `json:"purged_units"`
}

func (service *Service) PurgeCodeRunsForAttempt(contextValue context.Context, capability centralauthz.Capability, command PurgeCodeRuns) (PurgeCodeRunsResult, error) {
	command.Reason = strings.TrimSpace(command.Reason)
	command.TenantID = normalizeUUID(command.TenantID)
	command.AttemptID = normalizeUUID(command.AttemptID)
	command.ActorID = normalizeUUID(command.ActorID)
	if !isUUID(command.TenantID) || !isUUID(command.AttemptID) || !isUUID(command.ActorID) || command.Reason == "" {
		return PurgeCodeRunsResult{}, apperrors.New(apperrors.CodeInvalidArgument, "attempt ID, tenant ID, actor ID, and purge reason are required")
	}
	var result PurgeCodeRunsResult
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		result, storeErr = service.store.PurgeCodeRunsForAttempt(contextValue, transaction, command)
		return storeErr
	})
	if err != nil {
		return PurgeCodeRunsResult{}, fmt.Errorf("purge code runs for attempt: %w", err)
	}
	return result, nil
}
