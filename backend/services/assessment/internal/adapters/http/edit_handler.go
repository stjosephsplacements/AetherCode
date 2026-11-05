package httpadapter

import (
	"net/http"
	"time"

	"github.com/stjosephsplacements/AetherCode/libs/pkg/httpx"
	"github.com/stjosephsplacements/AetherCode/services/assessment/internal/app"
)

type updateExamVersionRequest struct {
	ExpectedContentVersion int64      `json:"expected_content_version"`
	Title                  *string    `json:"title"`
	InstructionsMarkdown   *string    `json:"instructions_markdown"`
	OpensAt                *time.Time `json:"opens_at"`
	ClosesAt               *time.Time `json:"closes_at"`
	DurationSeconds        *int       `json:"duration_seconds"`
}

// updateExamVersion edits a draft exam's title, instructions, window or duration (ADR-0054).
func (handler *Handler) updateExamVersion(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	versionID, err := httpx.ParseUUIDPathValue(request, "exam_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body updateExamVersionRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "exam_versions", versionID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.UpdateExamVersion(request.Context(), decision.Capability, app.UpdateExamVersion{
		WriteCommand: app.WriteCommand{IdempotencyKey: key}, ID: versionID, TenantID: tenantID, ExpectedContentVersion: body.ExpectedContentVersion,
		Title: body.Title, InstructionsMarkdown: body.InstructionsMarkdown, OpensAt: body.OpensAt, ClosesAt: body.ClosesAt, DurationSeconds: body.DurationSeconds,
	}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

type updateExamSectionRequest struct {
	ExpectedContentVersion int64   `json:"expected_content_version"`
	Title                  *string `json:"title"`
	InstructionsMarkdown   *string `json:"instructions_markdown"`
	TimeLimitSeconds       *int    `json:"time_limit_seconds"`
	ClearTimeLimit         bool    `json:"clear_time_limit"`
}

func (handler *Handler) updateExamSection(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	versionID, err := httpx.ParseUUIDPathValue(request, "exam_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	sectionID, err := httpx.ParseUUIDPathValue(request, "section_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body updateExamSectionRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "exam_sections", sectionID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.UpdateExamSection(request.Context(), decision.Capability, app.UpdateExamSection{
		WriteCommand: app.WriteCommand{IdempotencyKey: key}, ID: sectionID, TenantID: tenantID, ExamVersionID: versionID, ExpectedContentVersion: body.ExpectedContentVersion,
		Title: body.Title, InstructionsMarkdown: body.InstructionsMarkdown, TimeLimitSeconds: body.TimeLimitSeconds, ClearTimeLimit: body.ClearTimeLimit,
	}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

type updateExamItemRequest struct {
	ExpectedContentVersion int64  `json:"expected_content_version"`
	MaximumScore           string `json:"maximum_score"`
}

func (handler *Handler) updateExamItem(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	versionID, err := httpx.ParseUUIDPathValue(request, "exam_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	itemID, err := httpx.ParseUUIDPathValue(request, "item_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body updateExamItemRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "exam_items", itemID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.UpdateExamItem(request.Context(), decision.Capability, app.UpdateExamItem{
		WriteCommand: app.WriteCommand{IdempotencyKey: key}, ID: itemID, TenantID: tenantID, ExamVersionID: versionID,
		ExpectedContentVersion: body.ExpectedContentVersion, MaximumScore: body.MaximumScore,
	}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}
