package app

import (
	"context"
	"fmt"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/jackc/pgx/v5"
)

// RepinExamItem points an item of an exam, published or not, at a corrected
// published version of its own coding question and re-sends every assignment
// of the exam version, so Submission grades against the corrected tests
// (ADR-0039). Marks stay as they were.
type RepinExamItem struct {
	TenantID          string
	ExamVersionID     string
	ItemID            string
	QuestionVersionID string
	EventID           string
	Resolved          ResolvedQuestionVersion
}

func (service *Service) RepinExamItem(ctx context.Context, capability centralauthz.Capability, command RepinExamItem) (int, error) {
	command.TenantID, command.ExamVersionID = normalizeID(command.TenantID), normalizeID(command.ExamVersionID)
	command.ItemID, command.QuestionVersionID = normalizeID(command.ItemID), normalizeID(command.QuestionVersionID)
	if !validID(command.TenantID) || !validID(command.ExamVersionID) || !validID(command.ItemID) || !validID(command.QuestionVersionID) {
		return 0, invalid("exam item and question version IDs must be UUIDs")
	}
	resolved, err := service.questionBank.ResolvePublishedQuestionVersion(ctx, command.QuestionVersionID)
	if err != nil {
		return 0, err
	}
	if resolved.Kind == "mcq" || resolved.QuestionVersionID != command.QuestionVersionID || !validID(resolved.QuestionID) ||
		!validBundle(resolved.EvaluationBundle) || !validBundle(resolved.SampleBundle) || !validExecution(resolved) || !validStatement(resolved) {
		return 0, invalid("only a published coding question version can replace an item")
	}
	command.Resolved = resolved
	if command.EventID, err = database.NewUUIDv7(); err != nil {
		return 0, err
	}
	var resent int
	err = database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		resent, storeErr = service.store.RepinExamItem(ctx, transaction, command)
		return storeErr
	})
	if err != nil {
		return 0, fmt.Errorf("repin exam item: %w", err)
	}
	return resent, nil
}

// MoveAssignmentWindow moves an assignment rule's close time after
// publication, the exam app's "push the window back" (ADR-0040).
type MoveAssignmentWindow struct {
	TenantID         string
	AssignmentRuleID string
	AvailableUntil   time.Time
	EventID          string
}

func (service *Service) MoveAssignmentWindow(ctx context.Context, capability centralauthz.Capability, command MoveAssignmentWindow) (int, error) {
	command.TenantID, command.AssignmentRuleID = normalizeID(command.TenantID), normalizeID(command.AssignmentRuleID)
	if !validID(command.TenantID) || !validID(command.AssignmentRuleID) || command.AvailableUntil.IsZero() {
		return 0, invalid("an assignment rule and a new close time are required")
	}
	var err error
	if command.EventID, err = database.NewUUIDv7(); err != nil {
		return 0, err
	}
	var moved int
	err = database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		moved, storeErr = service.store.MoveAssignmentWindow(ctx, transaction, command)
		return storeErr
	})
	return moved, err
}
