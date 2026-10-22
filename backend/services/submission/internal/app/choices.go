package app

import (
	"context"
	"encoding/json"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/jackc/pgx/v5"
)

// SaveChoice stores a candidate's selection for one multiple-choice item
// (ADR-0035). Selected holds the options' authored indexes; empty clears it.
type SaveChoice struct {
	TenantID   string
	AttemptID  string
	ExamItemID string
	Selected   []int
}

func (service *Service) SaveChoice(contextValue context.Context, capability centralauthz.Capability, command SaveChoice) (json.RawMessage, error) {
	command.TenantID, command.AttemptID, command.ExamItemID = normalizeUUID(command.TenantID), normalizeUUID(command.AttemptID), normalizeUUID(command.ExamItemID)
	if !isUUID(command.TenantID) || !isUUID(command.AttemptID) || !isUUID(command.ExamItemID) || len(command.Selected) > 10 {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "a selection names at most 10 options of one question")
	}
	if command.Selected == nil {
		command.Selected = []int{}
	}
	var saved json.RawMessage
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		saved, storeErr = service.store.SaveChoice(contextValue, transaction, command)
		return storeErr
	})
	return saved, err
}
