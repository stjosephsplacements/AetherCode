package app

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/database"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
)

var allowedClientProctorKinds = map[string]struct{}{
	"face_missing": {}, "multiple_faces": {}, "phone_detected": {},
}

// ClientProctorHint is one advisory browser-side detection (ADR-0078 phase 3).
type ClientProctorHint struct {
	ID         string  `json:"id"`
	Kind       string  `json:"kind"`
	Confidence float32 `json:"confidence"`
	RecordedAt string  `json:"recorded_at"`
}

// RecordClientProctorHint stores an advisory hint; it never counts toward breach.
func (service *Service) RecordClientProctorHint(contextValue context.Context, capability centralauthz.Capability, command GetAttempt, kind string, confidence float32) error {
	command.TenantID, command.AttemptID = normalizeUUID(command.TenantID), normalizeUUID(command.AttemptID)
	if !isUUID(command.TenantID) || !isUUID(command.AttemptID) {
		return apperrors.New(apperrors.CodeInvalidArgument, "tenant and attempt identifiers are required")
	}
	if _, ok := allowedClientProctorKinds[kind]; !ok {
		return apperrors.New(apperrors.CodeInvalidArgument, "client proctor kind is not supported")
	}
	if confidence < 0 || confidence > 1 {
		return apperrors.New(apperrors.CodeInvalidArgument, "confidence must be between 0 and 1")
	}
	return service.inTenant(contextValue, capability, func(transaction pgx.Tx) error {
		return service.store.RecordClientProctorHint(contextValue, transaction, command, kind, confidence)
	})
}

// ListClientProctorHints returns advisory hints for staff review.
func (service *Service) ListClientProctorHints(contextValue context.Context, capability centralauthz.Capability, command GetAttempt) ([]ClientProctorHint, error) {
	command.TenantID, command.AttemptID = normalizeUUID(command.TenantID), normalizeUUID(command.AttemptID)
	if !isUUID(command.TenantID) || !isUUID(command.AttemptID) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "tenant and attempt identifiers are required")
	}
	var raw json.RawMessage
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		raw, storeErr = service.store.ListClientProctorHints(contextValue, transaction, command)
		return storeErr
	})
	if err != nil {
		return nil, err
	}
	var hints []ClientProctorHint
	if err := json.Unmarshal(raw, &hints); err != nil {
		return nil, err
	}
	return hints, nil
}