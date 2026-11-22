package httpadapter

import (
	"net/http"
	"strings"

	"github.com/stjosephsplacements/AetherCode/libs/pkg/httpx"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/pagination"
	"github.com/stjosephsplacements/AetherCode/services/user/internal/app"
)

func WithPlatformProfiles(platformProfiles *app.PlatformProfiles) Option {
	return func(handler *Handler) { handler.platformProfiles = platformProfiles }
}

func (handler *Handler) registerPlatformProfiles(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/platform-profiles", handler.listPlatformProfiles)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/platform-profiles/sync", handler.syncPlatformProfilesCollege)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/students/{student_id}/platform-profiles/sync", handler.syncPlatformProfilesStudent)
}

func (handler *Handler) listPlatformProfiles(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	limit, err := pagination.ParseLimit(request.URL.Query().Get("limit"), 50, 200)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "platform_profiles", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	batchID := strings.TrimSpace(request.URL.Query().Get("batch_id"))
	if batchID != "" {
		batchID, err = httpx.ParseUUIDValue(batchID, "batch_id")
		if err != nil {
			httpx.WriteError(writer, err)
			return
		}
	}
	page, err := handler.platformProfiles.List(request.Context(), decision.Capability, app.ListPlatformProfiles{
		TenantID: tenantID,
		Platform: request.URL.Query().Get("platform"),
		Status:   request.URL.Query().Get("status"),
		BatchID:  batchID,
		Limit:    limit,
		Cursor:   request.URL.Query().Get("cursor"),
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

func (handler *Handler) syncPlatformProfilesCollege(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "platform_profiles", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.platformProfiles.RequestSync(request.Context(), decision.Capability, tenantID, ""); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusAccepted, map[string]bool{"queued": true})
}

func (handler *Handler) syncPlatformProfilesStudent(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	studentID, err := httpx.ParseUUIDPathValue(request, "student_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "platform_profiles", studentID, tenantID)
	if err != nil {
		decision, err = handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, "read", "students", tenantID)
	}
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.platformProfiles.RequestSync(request.Context(), decision.Capability, tenantID, studentID); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusAccepted, map[string]bool{"queued": true})
}
