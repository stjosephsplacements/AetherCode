package httpadapter

import (
	"net/http"

	"github.com/stjosephsplacements/AetherCode/libs/pkg/httpx"
	"github.com/stjosephsplacements/AetherCode/services/user/internal/app"
)

type permissionsRequest struct {
	Permissions []string `json:"permissions"`
}

type permissionsResponse struct {
	Permissions []string `json:"permissions"`
}

// permissionCatalogue lists everything that can be granted (ADR-0055). It is the same for everyone.
func (handler *Handler) permissionCatalogue(writer http.ResponseWriter, request *http.Request) {
	if _, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "permission_grants", "catalogue", ""); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, map[string]any{"permissions": app.PermissionCatalogue()})
}

func (handler *Handler) listPermissions(writer http.ResponseWriter, request *http.Request) {
	tenantID, principalID, ok := permissionTarget(writer, request, true)
	if !ok {
		return
	}
	handler.writePermissions(writer, request, tenantID, principalID)
}

func (handler *Handler) listPlatformPermissions(writer http.ResponseWriter, request *http.Request) {
	tenantID, principalID, ok := permissionTarget(writer, request, false)
	if !ok {
		return
	}
	handler.writePermissions(writer, request, tenantID, principalID)
}

func (handler *Handler) writePermissions(writer http.ResponseWriter, request *http.Request, tenantID, principalID string) {
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "permission_grants", principalID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	permissions, err := handler.service.ListPermissionGrants(request.Context(), decision.Capability, principalID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, permissionsResponse{Permissions: permissions})
}

func (handler *Handler) setPermissions(writer http.ResponseWriter, request *http.Request) {
	tenantID, principalID, ok := permissionTarget(writer, request, true)
	if !ok {
		return
	}
	handler.savePermissions(writer, request, tenantID, principalID)
}

func (handler *Handler) setPlatformPermissions(writer http.ResponseWriter, request *http.Request) {
	tenantID, principalID, ok := permissionTarget(writer, request, false)
	if !ok {
		return
	}
	handler.savePermissions(writer, request, tenantID, principalID)
}

func (handler *Handler) savePermissions(writer http.ResponseWriter, request *http.Request, tenantID, principalID string) {
	var body permissionsRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "permission_grants", principalID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	permissions, err := handler.service.SetPermissionGrants(request.Context(), decision.Capability, app.SetPermissionGrants{
		PrincipalID: principalID, TenantID: tenantID, Permissions: body.Permissions,
		GrantedBy: decision.PrincipalID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, permissionsResponse{Permissions: permissions})
}

// permissionTarget reads the person (and, for a college's permissions, the college) from the path.
func permissionTarget(writer http.ResponseWriter, request *http.Request, college bool) (tenantID, principalID string, ok bool) {
	var err error
	if college {
		if tenantID, err = httpx.ParseUUIDPathValue(request, "tenant_id"); err != nil {
			httpx.WriteError(writer, err)
			return "", "", false
		}
	}
	if principalID, err = httpx.ParseUUIDPathValue(request, "principal_id"); err != nil {
		httpx.WriteError(writer, err)
		return "", "", false
	}
	return tenantID, principalID, true
}
