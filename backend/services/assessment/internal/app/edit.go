package app

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
)

// Edits to a draft exam (ADR-0054). A nil field is left as it is; the content
// version has to match, as for adding and removing sections and items.

type UpdateExamVersion struct {
	WriteCommand
	ID                     string
	TenantID               string
	ExpectedContentVersion int64
	Title                  *string
	InstructionsMarkdown   *string
	OpensAt                *time.Time
	ClosesAt               *time.Time
	DurationSeconds        *int
}

type UpdateExamSection struct {
	WriteCommand
	ID                     string
	TenantID               string
	ExamVersionID          string
	ExpectedContentVersion int64
	Title                  *string
	InstructionsMarkdown   *string
	TimeLimitSeconds       *int
	ClearTimeLimit         bool
}

type UpdateExamItem struct {
	WriteCommand
	ID                     string
	TenantID               string
	ExamVersionID          string
	ExpectedContentVersion int64
	MaximumScore           string
}

func trimmedPtr(value *string) *string {
	if value == nil {
		return nil
	}
	text := strings.TrimSpace(*value)
	return &text
}

func (service *Service) UpdateExamVersion(ctx context.Context, capability centralauthz.Capability, command UpdateExamVersion) error {
	command.ID, command.TenantID = normalizeID(command.ID), normalizeID(command.TenantID)
	command.Title, command.InstructionsMarkdown = trimmedPtr(command.Title), trimmedPtr(command.InstructionsMarkdown)
	if !validID(command.ID) || !validID(command.TenantID) || command.ExpectedContentVersion <= 0 {
		return invalid("exam update fields are invalid")
	}
	if command.Title == nil && command.InstructionsMarkdown == nil && command.OpensAt == nil && command.ClosesAt == nil && command.DurationSeconds == nil {
		return invalid("give at least one field to change")
	}
	if (command.Title != nil && (*command.Title == "" || len([]rune(*command.Title)) > 300)) || (command.InstructionsMarkdown != nil && *command.InstructionsMarkdown == "") ||
		(command.DurationSeconds != nil && (*command.DurationSeconds < 60 || *command.DurationSeconds > 43200)) ||
		(command.OpensAt != nil && command.ClosesAt != nil && !command.OpensAt.Before(*command.ClosesAt)) {
		return invalid("the title is 1 to 300 characters, the duration 1 minute to 12 hours, and the exam opens before it closes")
	}
	_, err := runWrite(service, ctx, capability, command.TenantID, "assessment.exam_version.update", command.IdempotencyKey, command, httpStatusOK,
		func(transaction pgx.Tx) (struct{}, error) {
			return struct{}{}, service.store.UpdateExamVersion(ctx, transaction, command)
		})
	return err
}

func (service *Service) UpdateExamSection(ctx context.Context, capability centralauthz.Capability, command UpdateExamSection) error {
	command.ID, command.TenantID, command.ExamVersionID = normalizeID(command.ID), normalizeID(command.TenantID), normalizeID(command.ExamVersionID)
	command.Title, command.InstructionsMarkdown = trimmedPtr(command.Title), trimmedPtr(command.InstructionsMarkdown)
	if !validID(command.ID) || !validID(command.TenantID) || !validID(command.ExamVersionID) || command.ExpectedContentVersion <= 0 {
		return invalid("exam section update fields are invalid")
	}
	if command.Title == nil && command.InstructionsMarkdown == nil && command.TimeLimitSeconds == nil && !command.ClearTimeLimit {
		return invalid("give at least one field to change")
	}
	if (command.Title != nil && (*command.Title == "" || len([]rune(*command.Title)) > 300)) ||
		(command.TimeLimitSeconds != nil && (*command.TimeLimitSeconds < 60 || *command.TimeLimitSeconds > 43200 || command.ClearTimeLimit)) {
		return invalid("the title is 1 to 300 characters and the time limit 1 minute to 12 hours")
	}
	_, err := runWrite(service, ctx, capability, command.TenantID, "assessment.exam_section.update", command.IdempotencyKey, command, httpStatusOK,
		func(transaction pgx.Tx) (struct{}, error) {
			return struct{}{}, service.store.UpdateExamSection(ctx, transaction, command)
		})
	return err
}

func (service *Service) UpdateExamItem(ctx context.Context, capability centralauthz.Capability, command UpdateExamItem) error {
	command.ID, command.TenantID, command.ExamVersionID = normalizeID(command.ID), normalizeID(command.TenantID), normalizeID(command.ExamVersionID)
	command.MaximumScore = strings.TrimSpace(command.MaximumScore)
	if !validID(command.ID) || !validID(command.TenantID) || !validID(command.ExamVersionID) || command.ExpectedContentVersion <= 0 || !validScore(command.MaximumScore) {
		return invalid("exam item update fields are invalid")
	}
	_, err := runWrite(service, ctx, capability, command.TenantID, "assessment.exam_item.update", command.IdempotencyKey, command, httpStatusOK,
		func(transaction pgx.Tx) (struct{}, error) {
			return struct{}{}, service.store.UpdateExamItem(ctx, transaction, command)
		})
	return err
}
