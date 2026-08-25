// Package httpadapter exposes candidate-safe Submission workflows over HTTP.
package httpadapter

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/authn"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/httpauth"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/libs/pkg/pagination"
	"github.com/aethercode/aethercode/libs/pkg/ratelimit"
	"github.com/aethercode/aethercode/services/submission/internal/app"
)

// retryAfterStartAttempt is the Retry-After value sent with 429 responses on
// the attempt-creation endpoint. One hour matches the token-bucket refill
// window.
const retryAfterStartAttempt = "3600"

type Handler struct {
	service             *app.Service
	authorizer          *httpauth.Authorizer
	startAttemptLimiter *ratelimit.Limiter
}

// NewHandler installs concrete submission workflows on an operational mux.
// startAttemptLimiter may be nil to disable per-candidate rate limiting on
// attempt creation.
func NewHandler(serviceName string, service *app.Service, readiness httpx.ReadinessFunc, authorizer *httpauth.Authorizer, startAttemptLimiter *ratelimit.Limiter) (http.Handler, error) {
	if service == nil || authorizer == nil {
		return nil, fmt.Errorf("submission service and authorizer are required")
	}
	handler := &Handler{service: service, authorizer: authorizer, startAttemptLimiter: startAttemptLimiter}
	mux := httpx.NewOperationalMux(serviceName, readiness)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/attempts", handler.startAttempt)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/attempts/{attempt_id}", handler.getAttempt)
	mux.HandleFunc("PUT /v1/tenants/{tenant_id}/attempts/{attempt_id}/answers/{exam_item_id}", handler.appendAnswerRevision)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/attempts/{attempt_id}/submit", handler.submitAttempt)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/attempts/{attempt_id}", handler.deleteAttempt)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/attempts/{attempt_id}/hard", handler.hardDeleteAttempt)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/attempts", handler.listAttempts)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/attempts/{attempt_id}/answers", handler.listAnswerRevisions)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/attempts/{attempt_id}/unit-results", handler.getAttemptUnitSummary)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/attempts/{attempt_id}/judge-receipts", handler.listAttemptUnitResults)
	return mux, nil
}

type startAttemptRequest struct {
	CandidateAssignmentID string `json:"candidate_assignment_id"`
}

func (handler *Handler) startAttempt(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body startAttemptRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	idempotencyKey, err := requiredIdempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	attemptID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	candidateID, err := candidateResourceID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if handler.startAttemptLimiter != nil {
		if !handler.startAttemptLimiter.Allow(candidateID, time.Now().UTC()) {
			writer.Header().Set("Retry-After", retryAfterStartAttempt)
			httpx.WriteJSON(writer, http.StatusTooManyRequests, httpx.Problem{Code: "too_many_requests", Message: "attempt creation rate limit exceeded"})
			return
		}
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "attempts", candidateID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	attempt, err := handler.service.StartAttempt(request.Context(), decision.Capability, app.StartAttempt{
		ID: attemptID, TenantID: tenantID, CandidateAssignmentID: body.CandidateAssignmentID,
		IdempotencyKey: idempotencyKey,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, attempt)
}

func (handler *Handler) getAttempt(writer http.ResponseWriter, request *http.Request) {
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
	attempt, err := handler.service.GetAttempt(request.Context(), decision.Capability, app.GetAttempt{
		TenantID: tenantID, AttemptID: attemptID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, attempt)
}

type appendAnswerRevisionRequest struct {
	LanguageID             string `json:"language_id"`
	SourceObjectKey        string `json:"source_object_key"`
	SourceChecksum         string `json:"source_checksum"`
	EncryptionKeyReference string `json:"encryption_key_reference"`
	ExpectedAttemptVersion int64  `json:"expected_attempt_version"`
}

func (handler *Handler) appendAnswerRevision(writer http.ResponseWriter, request *http.Request) {
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
	var body appendAnswerRevisionRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	revisionID, err := database.NewUUIDv7()
	if err != nil {
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
	revision, err := handler.service.AppendAnswerRevision(request.Context(), decision.Capability, app.AppendAnswerRevision{
		ID: revisionID, TenantID: tenantID, AttemptID: attemptID, ExamItemID: examItemID,
		LanguageID: body.LanguageID, SourceObjectKey: body.SourceObjectKey,
		SourceChecksum: body.SourceChecksum, EncryptionKeyReference: body.EncryptionKeyReference,
		ExpectedAttemptVersion: body.ExpectedAttemptVersion,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, revision)
}

type submitAttemptRequest struct {
	ExpectedAttemptVersion int64 `json:"expected_attempt_version"`
}

func (handler *Handler) submitAttempt(writer http.ResponseWriter, request *http.Request) {
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
	var body submitAttemptRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	idempotencyKey, err := requiredIdempotencyKey(request)
	if err != nil {
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
	result, err := handler.service.SubmitAttempt(request.Context(), decision.Capability, app.SubmitAttempt{
		TenantID: tenantID, AttemptID: attemptID, ExpectedAttemptVersion: body.ExpectedAttemptVersion,
		IdempotencyKey: idempotencyKey,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusAccepted, result)
}

func requiredIdempotencyKey(request *http.Request) (string, error) {
	key := strings.TrimSpace(request.Header.Get("Idempotency-Key"))
	if len([]rune(key)) == 0 || len([]rune(key)) > 255 {
		return "", apperrors.New(apperrors.CodeInvalidArgument, "Idempotency-Key header is required and must be at most 255 characters")
	}
	return key, nil
}

// candidateResourceID is routing input only. The central User service verifies
// the same assertion before issuing the signed database capability; the local
// stored procedures bind the capability actor to the candidate-owned record.
func candidateResourceID(request *http.Request) (string, error) {
	assertion, err := httpx.BearerToken(request)
	if err != nil {
		return "", err
	}
	principalID, err := authn.UnverifiedSubject(assertion)
	if err != nil {
		return "", apperrors.New(apperrors.CodeUnauthorized, "access token is invalid")
	}
	return principalID, nil
}

type deleteAttemptRequest struct {
	Reason string `json:"reason"`
}

func (handler *Handler) deleteAttempt(writer http.ResponseWriter, request *http.Request) {
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
	var body deleteAttemptRequest
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
	if err := handler.service.DeleteAttempt(request.Context(), decision.Capability, app.DeleteAttempt{
		ID:       attemptID,
		TenantID: tenantID,
		ActorID:  decision.PrincipalID,
		Reason:   body.Reason,
	}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) hardDeleteAttempt(writer http.ResponseWriter, request *http.Request) {
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
	var body deleteAttemptRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	candidateID, err := candidateResourceID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "attempts", candidateID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.HardDeleteAttempt(request.Context(), decision.Capability, app.DeleteAttempt{
		ID:       attemptID,
		TenantID: tenantID,
		ActorID:  decision.PrincipalID,
		Reason:   body.Reason,
	}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) listAttempts(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	limit, err := pagination.ParseLimit(request.URL.Query().Get("limit"), 20, 100)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	cursor, _, err := pagination.Parse(request.URL.Query().Get("cursor"))
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	examVersionID, err := optionalUUIDQuery(request, "exam_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	lifecycleState, err := httpx.ParseEnumQuery(request, "lifecycle_state",
		"created", "active", "submitted", "grading", "graded", "expired", "cancelled")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	// The candidate collection authorizes with the bearer subject as the
	// resource; Submission binds rows to the signed actor in the database.
	decision, err := handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, "read", "attempts", tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListAttempts(request.Context(), decision.Capability, app.ListAttempts{
		TenantID: tenantID, Limit: limit,
		CursorSort: cursor.SortValue, CursorID: cursor.ID,
		ExamVersionID:  examVersionID,
		LifecycleState: lifecycleState,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

func (handler *Handler) listAnswerRevisions(writer http.ResponseWriter, request *http.Request) {
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
	limit, err := pagination.ParseLimit(request.URL.Query().Get("limit"), 20, 100)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	cursor, _, err := pagination.Parse(request.URL.Query().Get("cursor"))
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	examItemID, err := optionalUUIDQuery(request, "exam_item_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, "read", "attempts", tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListAnswerRevisions(request.Context(), decision.Capability, app.ListAnswerRevisions{
		TenantID: tenantID, AttemptID: attemptID, Limit: limit,
		CursorSort: cursor.SortValue, CursorID: cursor.ID,
		ExamItemID: examItemID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

// getAttemptUnitSummary serves the candidate-safe hidden-test counts. It
// authorizes against `attempts` with the bearer subject as the resource, so the
// database routine can bind the rows to the signed actor exactly as the other
// candidate collections do.
func (handler *Handler) getAttemptUnitSummary(writer http.ResponseWriter, request *http.Request) {
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
	decision, err := handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, "read", "attempts", tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.GetAttemptUnitSummary(request.Context(), decision.Capability, app.GetAttempt{
		TenantID: tenantID, AttemptID: attemptID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

// listAttemptUnitResults serves the full per-unit breakdown. It authorizes
// against `judge_receipts`, a resource the canonical policy grants only to
// college-, department-, batch-, or platform-scoped roles; a candidate's
// self-scoped assignment cannot name it, so this route fails closed for them
// before Submission is reached.
func (handler *Handler) listAttemptUnitResults(writer http.ResponseWriter, request *http.Request) {
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
	page, err := handler.service.ListAttemptUnitResults(request.Context(), decision.Capability, app.GetAttempt{
		TenantID: tenantID, AttemptID: attemptID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

// optionalUUIDQuery validates an optional UUID filter. An absent parameter is
// not an error; a present but malformed one is, so a typo never silently widens
// the result set.
func optionalUUIDQuery(request *http.Request, name string) (string, error) {
	raw := strings.TrimSpace(request.URL.Query().Get(name))
	if raw == "" {
		return "", nil
	}
	return httpx.ParseUUIDValue(raw, name)
}
