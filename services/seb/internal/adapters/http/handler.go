// Package httpadapter exposes the SEB control-plane API. Every business route
// receives a fresh central authorization decision before it opens an RLS-bound
// transaction; operational endpoints are the only unprotected routes.
package httpadapter

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/httpauth"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/services/seb/internal/app"
)

type Handler struct {
	service    service
	authorizer authorizer
}

// service keeps the HTTP adapter testable without loosening any transaction
// boundary: the production app.Service remains the only implementation.
type service interface {
	CreateConfiguration(context.Context, centralauthz.Capability, app.CreateConfiguration) (app.Configuration, error)
	GetConfiguration(context.Context, centralauthz.Capability, string, string) (app.Configuration, error)
	RotateConfiguration(context.Context, centralauthz.Capability, app.RotateConfiguration) (app.Configuration, error)
	RevokeConfiguration(context.Context, centralauthz.Capability, app.RevokeConfiguration) (app.Configuration, error)
	IssueSession(context.Context, centralauthz.Capability, app.IssueSession) (app.IssuedSession, error)
	GetSession(context.Context, centralauthz.Capability, string, string) (app.Session, error)
	CloseSession(context.Context, centralauthz.Capability, app.CloseSession) (app.Session, error)
	ValidateSessionHeader(context.Context, centralauthz.Capability, app.ValidateSessionHeader) (app.ValidationResult, error)
	ListSessions(context.Context, centralauthz.Capability, app.ListSessions) (app.Page[app.Session], error)
	ListConfigurations(context.Context, centralauthz.Capability, app.ListConfigurations) (app.Page[app.Configuration], error)
	DeleteConfiguration(context.Context, centralauthz.Capability, app.DeleteConfiguration) error
	HardDeleteConfiguration(context.Context, centralauthz.Capability, app.DeleteConfiguration) error
}

type authorizer interface {
	AuthorizeHTTP(context.Context, *http.Request, string, string, string, string) (httpauth.Decision, error)
	AuthorizeSelfHTTP(context.Context, *http.Request, string, string, string) (httpauth.Decision, error)
}

func NewHandler(serviceName string, service service, readiness httpx.ReadinessFunc, authorizer authorizer) (http.Handler, error) {
	if service == nil || authorizer == nil {
		return nil, fmt.Errorf("SEB service and authorizer are required")
	}
	handler := &Handler{service: service, authorizer: authorizer}
	mux := httpx.NewOperationalMux(serviceName, readiness)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/configurations", handler.createConfiguration)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/configurations/{configuration_id}", handler.getConfiguration)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/configurations/{configuration_id}/rotate", handler.rotateConfiguration)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/configurations/{configuration_id}/revoke", handler.revokeConfiguration)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/sessions", handler.issueSession)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/sessions/{session_id}", handler.getSession)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/sessions/{session_id}/close", handler.closeSession)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/sessions/{session_id}/validate", handler.validateSession)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/sessions", handler.listSessions)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/configurations", handler.listConfigurations)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/configurations/{configuration_id}", handler.deleteConfiguration)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/configurations/{configuration_id}/hard", handler.hardDeleteConfiguration)
	return mux, nil
}

type configurationRequest struct {
	ExamID               string `json:"exam_id"`
	ExamVersionID        string `json:"exam_version_id"`
	ConfigurationVersion int    `json:"configuration_version"`
	ConfigObjectKey      string `json:"config_object_key"`
	ConfigChecksum       string `json:"config_checksum"`
	EncryptionKeyRef     string `json:"encryption_key_reference"`
	ConfigKeyHash        string `json:"config_key_hash"`
	BrowserExamKeyHash   string `json:"browser_exam_key_hash"`
}

func (handler *Handler) createConfiguration(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	idempotencyKey, err := requiredIdempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body configurationRequest
	raw, err := httpx.DecodeJSONRaw(request, &body)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	requestHash, err := database.HashRequestBody(raw)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	configurationID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	eventID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "configurations", configurationID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	configuration, err := handler.service.CreateConfiguration(request.Context(), decision.Capability, app.CreateConfiguration{
		ID: configurationID, TenantID: tenantID, ExamID: body.ExamID,
		ExamVersionID: body.ExamVersionID, ConfigurationVersion: body.ConfigurationVersion,
		ConfigObjectKey: body.ConfigObjectKey, ConfigChecksum: body.ConfigChecksum,
		EncryptionKeyRef: body.EncryptionKeyRef, ConfigKeyHash: body.ConfigKeyHash,
		BrowserExamKeyHash: body.BrowserExamKeyHash, CreatedBy: decision.PrincipalID,
		EventID: eventID, IdempotencyKey: idempotencyKey, RequestHash: requestHash,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, configuration)
}

func (handler *Handler) getConfiguration(writer http.ResponseWriter, request *http.Request) {
	tenantID, configurationID, err := tenantAndResourceID(request, "configuration_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "configurations", configurationID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	configuration, err := handler.service.GetConfiguration(request.Context(), decision.Capability, tenantID, configurationID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, configuration)
}

type rotationRequest struct {
	configurationRequest
	Reason string `json:"reason"`
}

func (handler *Handler) rotateConfiguration(writer http.ResponseWriter, request *http.Request) {
	tenantID, previousConfigurationID, err := tenantAndResourceID(request, "configuration_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	idempotencyKey, err := requiredIdempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body rotationRequest
	raw, err := httpx.DecodeJSONRaw(request, &body)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	requestHash, err := database.HashRequestBody(raw)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	replacementID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	rotationID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	eventID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "configurations", previousConfigurationID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	configuration, err := handler.service.RotateConfiguration(request.Context(), decision.Capability, app.RotateConfiguration{
		PreviousConfigurationID: previousConfigurationID, ReplacementID: replacementID,
		RotationID: rotationID, EventID: eventID, TenantID: tenantID, ExamID: body.ExamID,
		ExamVersionID: body.ExamVersionID, ConfigurationVersion: body.ConfigurationVersion,
		ConfigObjectKey: body.ConfigObjectKey, ConfigChecksum: body.ConfigChecksum,
		EncryptionKeyRef: body.EncryptionKeyRef, ConfigKeyHash: body.ConfigKeyHash,
		BrowserExamKeyHash: body.BrowserExamKeyHash, Reason: body.Reason,
		RotatedBy: decision.PrincipalID, IdempotencyKey: idempotencyKey, RequestHash: requestHash,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, configuration)
}

type revokeConfigurationRequest struct {
	Reason string `json:"reason"`
}

func (handler *Handler) revokeConfiguration(writer http.ResponseWriter, request *http.Request) {
	tenantID, configurationID, err := tenantAndResourceID(request, "configuration_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	idempotencyKey, err := requiredIdempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body revokeConfigurationRequest
	raw, err := httpx.DecodeJSONRaw(request, &body)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	requestHash, err := database.HashRequestBody(raw)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	eventID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "configurations", configurationID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	configuration, err := handler.service.RevokeConfiguration(request.Context(), decision.Capability, app.RevokeConfiguration{
		ID: configurationID, TenantID: tenantID, Reason: body.Reason,
		RevokedBy: decision.PrincipalID, EventID: eventID,
		IdempotencyKey: idempotencyKey, RequestHash: requestHash,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, configuration)
}

type issueSessionRequest struct {
	ConfigurationID string `json:"configuration_id"`
	AttemptID       string `json:"attempt_id"`
	CandidateID     string `json:"candidate_id"`
	ExpiresAt       string `json:"expires_at"`
}

func (handler *Handler) issueSession(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	idempotencyKey, err := requiredIdempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body issueSessionRequest
	raw, err := httpx.DecodeJSONRaw(request, &body)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	requestHash, err := database.HashRequestBody(raw)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(body.ExpiresAt))
	if err != nil {
		httpx.WriteError(writer, invalidRequest("expires_at must be RFC3339"))
		return
	}
	sessionID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	eventID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "sessions", sessionID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	issued, err := handler.service.IssueSession(request.Context(), decision.Capability, app.IssueSession{
		ID: sessionID, EventID: eventID, TenantID: tenantID,
		ConfigurationID: body.ConfigurationID, AttemptID: body.AttemptID,
		CandidateID: body.CandidateID, ExpiresAt: expiresAt,
		IdempotencyKey: idempotencyKey, RequestHash: requestHash,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(writer, http.StatusCreated, issued)
}

func (handler *Handler) getSession(writer http.ResponseWriter, request *http.Request) {
	tenantID, sessionID, err := tenantAndResourceID(request, "session_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "sessions", sessionID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	session, err := handler.service.GetSession(request.Context(), decision.Capability, tenantID, sessionID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, session)
}

type closeSessionRequest struct {
	ExpectedVersion int64  `json:"expected_version"`
	Reason          string `json:"reason"`
}

func (handler *Handler) closeSession(writer http.ResponseWriter, request *http.Request) {
	tenantID, sessionID, err := tenantAndResourceID(request, "session_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	idempotencyKey, err := requiredIdempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body closeSessionRequest
	raw, err := httpx.DecodeJSONRaw(request, &body)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	requestHash, err := database.HashRequestBody(raw)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	eventID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "sessions", sessionID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	session, err := handler.service.CloseSession(request.Context(), decision.Capability, app.CloseSession{
		ID: sessionID, TenantID: tenantID, ExpectedVersion: body.ExpectedVersion,
		Reason: body.Reason, EventID: eventID,
		IdempotencyKey: idempotencyKey, RequestHash: requestHash,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, session)
}

type validateSessionRequest struct {
	HeaderKind             string  `json:"header_kind"`
	HeaderValue            *string `json:"header_value"`
	RequestFingerprintHash string  `json:"request_fingerprint_hash"`
}

func (handler *Handler) validateSession(writer http.ResponseWriter, request *http.Request) {
	tenantID, sessionID, err := tenantAndResourceID(request, "session_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body validateSessionRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if (body.HeaderKind != "config_key" && body.HeaderKind != "browser_exam_key") || !lowerSHA256(body.RequestFingerprintHash) {
		httpx.WriteError(writer, invalidRequest("validation header kind and request fingerprint hash are required"))
		return
	}
	validationEventID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	// Validation is a candidate-self operation. The SQL procedure independently
	// binds this signed actor to seb.sessions.candidate_id before touching a
	// session, so a guessed session ID cannot cross candidate boundaries.
	decision, err := handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, "write", "validation_events", tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	command := app.ValidateSessionHeader{
		ValidationEventID: validationEventID, TenantID: tenantID, SessionID: sessionID,
		HeaderKind: body.HeaderKind, HeaderPresent: body.HeaderValue != nil,
		RequestFingerprintHash: body.RequestFingerprintHash,
	}
	if body.HeaderValue != nil {
		command.PresentedHeaderHash = app.HashHeaderValue(*body.HeaderValue)
	}
	result, err := handler.service.ValidateSessionHeader(request.Context(), decision.Capability, command)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(writer, http.StatusOK, struct {
		HeaderKind       string    `json:"header_kind"`
		ValidationResult string    `json:"validation_result"`
		OccurredAt       time.Time `json:"occurred_at"`
	}{
		HeaderKind: result.HeaderKind, ValidationResult: result.ValidationResult,
		OccurredAt: result.OccurredAt,
	})
}

func tenantAndResourceID(request *http.Request, resourceName string) (string, string, error) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		return "", "", err
	}
	resourceID, err := httpx.ParseUUIDPathValue(request, resourceName)
	if err != nil {
		return "", "", err
	}
	return tenantID, resourceID, nil
}

func invalidRequest(message string) error {
	return apperrors.New(apperrors.CodeInvalidArgument, message)
}

// requiredIdempotencyKey keeps every public state transition on the same
// retry contract. Validation audit events are deliberately excluded: each
// validation is a distinct append-only security observation.
func requiredIdempotencyKey(request *http.Request) (string, error) {
	values := request.Header.Values("Idempotency-Key")
	if len(values) != 1 {
		return "", invalidRequest("Idempotency-Key is required and must contain 1 to 255 printable characters")
	}
	key := values[0]
	if len(key) == 0 || len(key) > 255 {
		return "", invalidRequest("Idempotency-Key is required and must contain 1 to 255 printable characters")
	}
	for _, character := range key {
		if character < '!' || character > '~' {
			return "", invalidRequest("Idempotency-Key is required and must contain 1 to 255 printable characters")
		}
	}
	return key, nil
}

func lowerSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, character := range value {
		//nolint:staticcheck // QF1001: the negated-range form reads more clearly for character validation
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f')) {
			return false
		}
	}
	return true
}

type deleteConfigurationRequest struct {
	Reason string `json:"reason"`
}

func (handler *Handler) deleteConfiguration(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	configID, err := httpx.ParseUUIDPathValue(request, "configuration_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body deleteConfigurationRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "configurations", configID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.DeleteConfiguration(request.Context(), decision.Capability, app.DeleteConfiguration{ID: configID, TenantID: tenantID, ActorID: decision.PrincipalID, Reason: body.Reason}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) hardDeleteConfiguration(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	configID, err := httpx.ParseUUIDPathValue(request, "configuration_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body deleteConfigurationRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "configurations", configID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.HardDeleteConfiguration(request.Context(), decision.Capability, app.DeleteConfiguration{ID: configID, TenantID: tenantID, ActorID: decision.PrincipalID, Reason: body.Reason}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}
