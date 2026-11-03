package httpadapter

import (
	"net/http"

	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/services/user/internal/app"
)

// Option adds optional routes to the handler without changing its constructor.
type Option func(*Handler)

// WithRoles serves the college role and overwrite routes (ADR-0066).
func WithRoles(roles *app.RolesService) Option {
	return func(handler *Handler) { handler.roles = roles }
}

func (handler *Handler) registerRoles(mux interface {
	HandleFunc(string, func(http.ResponseWriter, *http.Request))
}) {
	mux.HandleFunc("GET /v1/permission-flags", handler.listPermissionFlags)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/roles", handler.listRoles)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/roles", handler.createRole)
	mux.HandleFunc("PATCH /v1/tenants/{tenant_id}/roles/{role_id}", handler.updateRole)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/roles/{role_id}", handler.deleteRole)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/role-overwrites", handler.listOverwrites)
	mux.HandleFunc("PUT /v1/tenants/{tenant_id}/role-overwrites", handler.putOverwrite)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/role-overwrites/{overwrite_id}", handler.deleteOverwrite)
}

type roleBody struct {
	Name        string   `json:"name"`
	Tier        int      `json:"tier"`
	Position    int      `json:"position"`
	Permissions []string `json:"permissions"`
}

type roleUpdateBody struct {
	Name        *string   `json:"name"`
	Position    *int      `json:"position"`
	Permissions *[]string `json:"permissions"`
}

type overwriteBody struct {
	NodeKind   string   `json:"node_kind"`
	NodeID     string   `json:"node_id"`
	TargetKind string   `json:"target_kind"`
	TargetID   string   `json:"target_id"`
	Allow      []string `json:"allow"`
	Deny       []string `json:"deny"`
}

func (handler *Handler) listPermissionFlags(writer http.ResponseWriter, request *http.Request) {
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "roles", "flags", "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	flags, err := handler.roles.Flags(request.Context(), decision.Capability)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, map[string]any{"flags": flags})
}

func (handler *Handler) listRoles(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "roles", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	roles, err := handler.roles.List(request.Context(), decision.Capability, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, map[string]any{"roles": roles})
}

func (handler *Handler) createRole(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body roleBody
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "roles", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	role, err := handler.roles.Create(request.Context(), decision.Capability, app.CreateRole{
		TenantID: tenantID, Name: body.Name, Tier: body.Tier, Position: body.Position, Permissions: body.Permissions,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, role)
}

func (handler *Handler) updateRole(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	roleID, err := httpx.ParseUUIDPathValue(request, "role_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body roleUpdateBody
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "roles", roleID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	role, err := handler.roles.Update(request.Context(), decision.Capability, app.UpdateRole{
		TenantID: tenantID, RoleID: roleID, Name: body.Name, Position: body.Position, Permissions: body.Permissions,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, role)
}

func (handler *Handler) deleteRole(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	roleID, err := httpx.ParseUUIDPathValue(request, "role_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "roles", roleID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.roles.Delete(request.Context(), decision.Capability, tenantID, roleID); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) listOverwrites(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "role_overwrites", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	query := request.URL.Query()
	overwrites, err := handler.roles.Overwrites(request.Context(), decision.Capability, tenantID, query.Get("node_kind"), query.Get("node_id"))
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, map[string]any{"overwrites": overwrites})
}

func (handler *Handler) putOverwrite(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body overwriteBody
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "role_overwrites", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	overwrite, err := handler.roles.Put(request.Context(), decision.Capability, app.PutOverwrite{
		TenantID: tenantID, NodeKind: body.NodeKind, NodeID: body.NodeID, TargetKind: body.TargetKind, TargetID: body.TargetID,
		Allow: body.Allow, Deny: body.Deny, GrantedBy: decision.PrincipalID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, overwrite)
}

func (handler *Handler) deleteOverwrite(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	overwriteID, err := httpx.ParseUUIDPathValue(request, "overwrite_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "role_overwrites", overwriteID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.roles.DeleteOverwrite(request.Context(), decision.Capability, tenantID, overwriteID); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}
