// Package httpadapter exposes the Notification service API. Every business
// route obtains a fresh central decision before opening its local RLS-bound
// transaction; only operational endpoints are unauthenticated.
package httpadapter

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/httpauth"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/services/notification/internal/app"
)

type Handler struct {
	service    *app.Service
	authorizer *httpauth.Authorizer
}

func NewHandler(serviceName string, service *app.Service, readiness httpx.ReadinessFunc, authorizer *httpauth.Authorizer) (http.Handler, error) {
	if service == nil || authorizer == nil {
		return nil, fmt.Errorf("notification service and authorizer are required")
	}
	handler := &Handler{service: service, authorizer: authorizer}
	mux := httpx.NewOperationalMux(serviceName, readiness)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/me/preferences", handler.listOwnPreferences)
	mux.HandleFunc("PUT /v1/tenants/{tenant_id}/me/preferences/in-app", handler.upsertOwnInAppPreference)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/me/notifications", handler.listOwnNotifications)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/notifications", handler.scheduleNotification)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/notifications/{notification_id}/cancel", handler.cancelNotification)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/notifications/{notification_id}", handler.deleteNotification)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/notifications/{notification_id}/hard", handler.hardDeleteNotification)
	return mux, nil
}

type preferenceRequest struct {
	Enabled         bool  `json:"enabled"`
	ExpectedVersion int64 `json:"expected_version"`
}

func (handler *Handler) upsertOwnInAppPreference(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body preferenceRequest
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
	preferenceID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, "write", "recipient_preferences", tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	preference, err := handler.service.UpsertOwnPreference(request.Context(), decision.Capability, app.UpsertOwnPreference{
		ID: preferenceID, TenantID: tenantID, Enabled: body.Enabled, ExpectedVersion: body.ExpectedVersion,
		IdempotencyKey: request.Header.Get("Idempotency-Key"), RequestHash: requestHash,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, preference)
}

func (handler *Handler) listOwnPreferences(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, "read", "recipient_preferences", tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	preferences, err := handler.service.ListOwnPreferences(request.Context(), decision.Capability, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, map[string]any{"items": preferences})
}

func (handler *Handler) listOwnNotifications(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	limit, err := parseLimit(request.URL.Query().Get("limit"))
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, "read", "notifications", tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	notifications, err := handler.service.ListOwnNotifications(request.Context(), decision.Capability, tenantID, limit)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, map[string]any{"items": notifications})
}

type scheduleRequest struct {
	RecipientID        string `json:"recipient_id"`
	Category           string `json:"category"`
	TemplateCode       string `json:"template_code"`
	ContentObjectKey   string `json:"content_object_key"`
	ContentChecksum    string `json:"content_checksum"`
	EncryptionKeyRef   string `json:"encryption_key_reference"`
	ScheduledAt        string `json:"scheduled_at"`
	RetentionSubjectID string `json:"retention_subject_id"`
}

func (handler *Handler) scheduleNotification(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body scheduleRequest
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
	scheduledAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(body.ScheduledAt))
	if err != nil {
		httpx.WriteError(writer, invalid("scheduled_at must be RFC3339"))
		return
	}
	notificationID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	eventID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "notifications", notificationID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	notification, err := handler.service.ScheduleNotification(request.Context(), decision.Capability, app.ScheduleNotification{
		ID: notificationID, EventID: eventID, TenantID: tenantID, RecipientID: body.RecipientID,
		Category: body.Category, TemplateCode: body.TemplateCode, ContentObjectKey: body.ContentObjectKey,
		ContentChecksum: body.ContentChecksum, EncryptionKeyRef: body.EncryptionKeyRef,
		ScheduledAt: scheduledAt, RetentionSubjectID: body.RetentionSubjectID,
		IdempotencyKey: request.Header.Get("Idempotency-Key"), RequestHash: requestHash,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, notification)
}

type cancellationRequest struct {
	ExpectedVersion int64  `json:"expected_version"`
	Reason          string `json:"reason"`
}

func (handler *Handler) cancelNotification(writer http.ResponseWriter, request *http.Request) {
	tenantID, notificationID, err := tenantAndNotificationID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body cancellationRequest
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
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "notifications", notificationID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	notification, err := handler.service.CancelNotification(request.Context(), decision.Capability, app.CancelNotification{
		ID: notificationID, EventID: eventID, TenantID: tenantID, ExpectedVersion: body.ExpectedVersion,
		Reason: body.Reason, IdempotencyKey: request.Header.Get("Idempotency-Key"), RequestHash: requestHash,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, notification)
}

func tenantAndNotificationID(request *http.Request) (string, string, error) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		return "", "", err
	}
	notificationID, err := httpx.ParseUUIDPathValue(request, "notification_id")
	if err != nil {
		return "", "", err
	}
	return tenantID, notificationID, nil
}

func parseLimit(raw string) (int, error) {
	if strings.TrimSpace(raw) == "" {
		return 50, nil
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 || limit > 100 {
		return 0, invalid("limit must be between 1 and 100")
	}
	return limit, nil
}

func invalid(message string) error {
	return apperrors.New(apperrors.CodeInvalidArgument, message)
}

type deleteNotificationRequest struct {
	Reason string `json:"reason"`
}

func (handler *Handler) deleteNotification(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	notificationID, err := httpx.ParseUUIDPathValue(request, "notification_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body deleteNotificationRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "notifications", notificationID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.DeleteNotificationByID(request.Context(), decision.Capability, app.DeleteNotification{ID: notificationID, TenantID: tenantID, ActorID: decision.PrincipalID, Reason: body.Reason}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) hardDeleteNotification(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	notificationID, err := httpx.ParseUUIDPathValue(request, "notification_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body deleteNotificationRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "notifications", notificationID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.HardDeleteNotificationByID(request.Context(), decision.Capability, app.DeleteNotification{ID: notificationID, TenantID: tenantID, ActorID: decision.PrincipalID, Reason: body.Reason}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}
