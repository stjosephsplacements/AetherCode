package httpadapter

import (
	"context"
	"encoding/json"
	"net/http"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/services/submission/internal/app"
)

// Exam-day operations (ADR-0027). Staff routes authorize on the exam version
// as resource; a candidate's self scope can never be granted score_summaries
// or attempt_events. Candidate routes authorize like every other attempt route
// and the database binds the attempt to the signed actor.

func (handler *Handler) registerOperations(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/monitor", handler.getExamMonitor)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/grading-queue", handler.getGradingQueue)
	mux.HandleFunc("PUT /v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/results-release", handler.releaseResults)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/extensions", handler.extendDeadlines)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/announcements", handler.postAnnouncement)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/attempts/{attempt_id}/live", handler.getAttemptLiveState)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/attempts/{attempt_id}/result", handler.getAttemptResult)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/attempts/{attempt_id}/review", handler.reviewAttempt)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/similarity", handler.similarityReport)
	mux.HandleFunc("PUT /v1/tenants/{tenant_id}/attempts/{attempt_id}/choices/{exam_item_id}", handler.saveChoice)
	mux.HandleFunc("PUT /v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/integrity", handler.setIntegrity)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/attempts/{attempt_id}/events", handler.recordIntegrityEvent)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/items/{exam_item_id}/regrade", handler.regradeItem)
}

// regradeItem evaluates an item's answers again on its current tests (ADR-0039).
func (handler *Handler) regradeItem(writer http.ResponseWriter, request *http.Request) {
	examItemID, err := httpx.ParseUUIDPathValue(request, "exam_item_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	command, capability, err := handler.authorizeExamVersion(request, "write", "score_summaries")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	result, err := handler.service.RegradeItem(request.Context(), capability, command, examItemID)
	writeRaw(writer, http.StatusOK, result, err)
}

type integrityRequest struct {
	RequireFullscreen  bool `json:"require_fullscreen"`
	BlockExternalPaste bool `json:"block_external_paste"`
}

func (handler *Handler) setIntegrity(writer http.ResponseWriter, request *http.Request) {
	var body integrityRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	command, capability, err := handler.authorizeExamVersion(request, "write", "attempt_events")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.SetIntegrity(request.Context(), capability, app.SetIntegrity{
		ExamVersionCommand: command, RequireFullscreen: body.RequireFullscreen, BlockExternalPaste: body.BlockExternalPaste,
	}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, body)
}

type integrityEventRequest struct {
	Kind string `json:"kind"`
}

func (handler *Handler) recordIntegrityEvent(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	attemptID, err := httpx.ParseUUIDPathValue(request, "attempt_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body integrityEventRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	candidateID, err := candidateResourceID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "attempts", candidateID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.RecordIntegrityEvent(request.Context(), decision.Capability, app.GetAttempt{TenantID: tenantID, AttemptID: attemptID}, body.Kind); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

type saveChoiceRequest struct {
	Selected []int `json:"selected"`
}

// saveChoice stores the candidate's selection for a multiple-choice item (ADR-0035).
func (handler *Handler) saveChoice(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	attemptID, err := httpx.ParseUUIDPathValue(request, "attempt_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	examItemID, err := httpx.ParseUUIDPathValue(request, "exam_item_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body saveChoiceRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	candidateID, err := candidateResourceID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "attempts", candidateID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	saved, err := handler.service.SaveChoice(request.Context(), decision.Capability, app.SaveChoice{
		TenantID: tenantID, AttemptID: attemptID, ExamItemID: examItemID, Selected: body.Selected,
	})
	writeRaw(writer, http.StatusOK, saved, err)
}

// similarityReport compares students' latest code per question (ADR-0031).
func (handler *Handler) similarityReport(writer http.ResponseWriter, request *http.Request) {
	command, capability, err := handler.authorizeExamVersion(request, "read", "judge_receipts")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	report, err := handler.service.SimilarityReport(request.Context(), capability, command)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(writer, http.StatusOK, report)
}

// reviewAttempt is the staff view of one attempt (ADR-0029). It authorizes
// judge_receipts, the reviewer resource, for the attempt.
func (handler *Handler) reviewAttempt(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	attemptID, err := httpx.ParseUUIDPathValue(request, "attempt_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "judge_receipts", attemptID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	review, err := handler.service.ReviewAttempt(request.Context(), decision.Capability, app.GetAttempt{TenantID: tenantID, AttemptID: attemptID})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(writer, http.StatusOK, review)
}

// authorizeExamVersion authorizes action on resource for the route's exam version.
func (handler *Handler) authorizeExamVersion(request *http.Request, action, resource string) (app.ExamVersionCommand, centralauthz.Capability, error) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		return app.ExamVersionCommand{}, centralauthz.Capability{}, err
	}
	examVersionID, err := httpx.ParseUUIDPathValue(request, "exam_version_id")
	if err != nil {
		return app.ExamVersionCommand{}, centralauthz.Capability{}, err
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, action, resource, examVersionID, tenantID)
	if err != nil {
		return app.ExamVersionCommand{}, centralauthz.Capability{}, err
	}
	return app.ExamVersionCommand{TenantID: tenantID, ExamVersionID: examVersionID}, decision.Capability, nil
}

func writeRaw(writer http.ResponseWriter, status int, body json.RawMessage, err error) {
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, status, body)
}

func (handler *Handler) getExamMonitor(writer http.ResponseWriter, request *http.Request) {
	command, capability, err := handler.authorizeExamVersion(request, "read", "score_summaries")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	monitor, err := handler.service.GetExamMonitor(request.Context(), capability, command)
	writeRaw(writer, http.StatusOK, monitor, err)
}

type releaseResultsRequest struct {
	Released bool `json:"released"`
}

func (handler *Handler) releaseResults(writer http.ResponseWriter, request *http.Request) {
	var body releaseResultsRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	command, capability, err := handler.authorizeExamVersion(request, "write", "score_summaries")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	released, err := handler.service.ReleaseResults(request.Context(), capability, app.ReleaseResults{
		ExamVersionCommand: command, Released: body.Released,
	})
	writeRaw(writer, http.StatusOK, released, err)
}

type extendDeadlinesRequest struct {
	Minutes   int    `json:"minutes"`
	AttemptID string `json:"attempt_id"`
}

func (handler *Handler) extendDeadlines(writer http.ResponseWriter, request *http.Request) {
	var body extendDeadlinesRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	command, capability, err := handler.authorizeExamVersion(request, "write", "attempt_events")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	extended, err := handler.service.ExtendDeadlines(request.Context(), capability, app.ExtendDeadlines{
		ExamVersionCommand: command, AttemptID: body.AttemptID, Minutes: body.Minutes,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, map[string]int{"extended_attempts": extended})
}

type postAnnouncementRequest struct {
	Body string `json:"body"`
}

func (handler *Handler) postAnnouncement(writer http.ResponseWriter, request *http.Request) {
	var body postAnnouncementRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	command, capability, err := handler.authorizeExamVersion(request, "write", "attempt_events")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	announcement, err := handler.service.PostAnnouncement(request.Context(), capability, app.PostAnnouncement{
		ExamVersionCommand: command, Body: body.Body,
	})
	writeRaw(writer, http.StatusCreated, announcement, err)
}

func (handler *Handler) getAttemptLiveState(writer http.ResponseWriter, request *http.Request) {
	handler.candidateRead(writer, request, handler.service.GetAttemptLiveState)
}

func (handler *Handler) getAttemptResult(writer http.ResponseWriter, request *http.Request) {
	handler.candidateRead(writer, request, handler.service.GetAttemptResult)
}

func (handler *Handler) candidateRead(
	writer http.ResponseWriter,
	request *http.Request,
	read func(context.Context, centralauthz.Capability, app.GetAttempt) (json.RawMessage, error),
) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	attemptID, err := httpx.ParseUUIDPathValue(request, "attempt_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	candidateID, err := candidateResourceID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "attempts", candidateID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	response, err := read(request.Context(), decision.Capability, app.GetAttempt{TenantID: tenantID, AttemptID: attemptID})
	writeRaw(writer, http.StatusOK, response, err)
}

// getGradingQueue shows staff the college's grading queue (ADR-0043).
func (handler *Handler) getGradingQueue(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "score_summaries", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	queue, err := handler.service.GetGradingQueue(request.Context(), decision.Capability, tenantID)
	writeRaw(writer, http.StatusOK, queue, err)
}
