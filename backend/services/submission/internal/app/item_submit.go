package app

import (
	"context"
	"encoding/json"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/jackc/pgx/v5"
)

// SubmitItem evaluates a candidate's latest saved code for one question
// against all of its tests while the exam is running (ADR-0025). Each item
// scores its best evaluation when the attempt is graded.
type SubmitItem struct {
	TenantID   string
	AttemptID  string
	ExamItemID string

	RequestID     string
	OutboxEventID string
}

// ItemSubmission is one evaluation of an item's code as the candidate sees it.
// Hidden tests appear only as counts per verdict: which test failed, and how
// long it ran, would describe a hidden test to a candidate still being graded.
type ItemSubmission struct {
	ID             string         `json:"id"`
	Origin         string         `json:"origin"`
	LifecycleState string         `json:"lifecycle_state"`
	LanguageID     string         `json:"language_id,omitempty"`
	RevisionNumber int            `json:"revision_number,omitempty"`
	QueuedAt       time.Time      `json:"queued_at"`
	CompletedAt    *time.Time     `json:"completed_at"`
	Verdict        *string        `json:"verdict"`
	Score          *string        `json:"score"`
	MaximumScore   string         `json:"maximum_score,omitempty"`
	PassedUnits    *int           `json:"passed_units"`
	TotalUnits     *int           `json:"total_units"`
	VerdictCounts  map[string]int `json:"verdict_counts"`
}

func (service *Service) SubmitItem(contextValue context.Context, capability centralauthz.Capability, command SubmitItem) (ItemSubmission, error) {
	command.TenantID = normalizeUUID(command.TenantID)
	command.AttemptID = normalizeUUID(command.AttemptID)
	command.ExamItemID = normalizeUUID(command.ExamItemID)
	if !isUUID(command.TenantID) || !isUUID(command.AttemptID) || !isUUID(command.ExamItemID) {
		return ItemSubmission{}, apperrors.New(apperrors.CodeInvalidArgument, "tenant, attempt and item IDs must be UUIDs")
	}
	var err error
	if command.RequestID, err = database.NewUUIDv7(); err != nil {
		return ItemSubmission{}, err
	}
	if command.OutboxEventID, err = database.NewUUIDv7(); err != nil {
		return ItemSubmission{}, err
	}
	var submission ItemSubmission
	err = database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		submission, storeErr = service.store.SubmitItem(contextValue, transaction, command)
		return storeErr
	})
	return submission, err
}

func (service *Service) ListItemSubmissions(contextValue context.Context, capability centralauthz.Capability, command SubmitItem) (Page[ItemSubmission], error) {
	command.TenantID = normalizeUUID(command.TenantID)
	command.AttemptID = normalizeUUID(command.AttemptID)
	command.ExamItemID = normalizeUUID(command.ExamItemID)
	if !isUUID(command.TenantID) || !isUUID(command.AttemptID) || !isUUID(command.ExamItemID) {
		return Page[ItemSubmission]{}, apperrors.New(apperrors.CodeInvalidArgument, "tenant, attempt and item IDs must be UUIDs")
	}
	var submissions []ItemSubmission
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		submissions, storeErr = service.store.ListItemSubmissions(contextValue, transaction, command)
		return storeErr
	})
	if submissions == nil {
		submissions = []ItemSubmission{}
	}
	return Page[ItemSubmission]{Items: submissions}, err
}

// DecodeItemSubmissions decodes list_item_submissions_for_candidate's JSON.
func DecodeItemSubmissions(raw json.RawMessage) ([]ItemSubmission, error) {
	var submissions []ItemSubmission
	if err := json.Unmarshal(raw, &submissions); err != nil {
		return nil, err
	}
	for index := range submissions {
		if submissions[index].VerdictCounts == nil {
			submissions[index].VerdictCounts = map[string]int{}
		}
	}
	return submissions, nil
}
