package httpadapter

import (
	"net/http"
	"strings"

	"github.com/stjosephsplacements/AetherCode/libs/pkg/database"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/httpx"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/pagination"
	"github.com/stjosephsplacements/AetherCode/services/user/internal/app"
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

// --- Role assignments (assign, list, revoke) ---

type roleAssignmentRequest struct {
	PrincipalID string `json:"principal_id"`
	RoleName    string `json:"role_name"`
	ScopeKind   string `json:"scope_kind"`
	TenantID    string `json:"tenant_id"`
	ScopeID     string `json:"scope_id"`
	ExpiresAt   string `json:"expires_at"`
}

func (handler *Handler) assignRole(writer http.ResponseWriter, request *http.Request) {
	var body roleAssignmentRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	principalID, err := httpx.ParseUUIDValue(body.PrincipalID, "principal_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	tenantID, err := optionalTenant(body.TenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	scopeID := strings.TrimSpace(body.ScopeID)
	if scopeID != "" {
		scopeID, err = httpx.ParseUUIDValue(scopeID, "scope_id")
		if err != nil {
			httpx.WriteError(writer, err)
			return
		}
	}
	expiresAt, err := parseOptionalExpiry(body.ExpiresAt)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "role_assignments", id, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	assignment, err := handler.service.AssignRole(request.Context(), decision.Capability, app.AssignRole{
		ID: id, PrincipalID: principalID, RoleName: body.RoleName, ScopeKind: body.ScopeKind,
		TenantID: tenantID, ScopeID: scopeID, GrantedByPrincipalID: decision.PrincipalID, ExpiresAt: expiresAt,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, assignment)
}

type revokeRoleRequest struct {
	TenantID string `json:"tenant_id"`
}

func (handler *Handler) revokeRole(writer http.ResponseWriter, request *http.Request) {
	assignmentID, err := httpx.ParseUUIDPathValue(request, "role_assignment_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body revokeRoleRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	tenantID, err := optionalTenant(body.TenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "role_assignments", assignmentID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	assignment, err := handler.service.RevokeRole(request.Context(), decision.Capability, app.RevokeRole{ID: assignmentID})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, assignment)
}

func (handler *Handler) listRoleAssignments(writer http.ResponseWriter, request *http.Request) {
	tenantID := strings.TrimSpace(request.Header.Get("X-Tenant-ID"))
	if tenantID != "" {
		var err error
		tenantID, err = httpx.ParseUUIDValue(tenantID, "X-Tenant-ID")
		if err != nil {
			httpx.WriteError(writer, err)
			return
		}
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
	principalID := strings.TrimSpace(request.URL.Query().Get("principal_id"))
	if principalID != "" {
		principalID, err = httpx.ParseUUIDValue(principalID, "principal_id")
		if err != nil {
			httpx.WriteError(writer, err)
			return
		}
	}
	roleName, err := httpx.ParseEnumQuery(request, "role_name",
		"super_admin", "placement_user", "college_admin", "department_user", "mentor", "student")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	scopeKind, err := httpx.ParseEnumQuery(request, "scope_kind",
		"platform", "college", "department", "batch", "placement_department", "self")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	principalFilterOrTenant := principalID
	if principalFilterOrTenant == "" {
		principalFilterOrTenant = tenantID
	}
	if principalFilterOrTenant == "" {
		principalFilterOrTenant = "all"
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "role_assignments", principalFilterOrTenant, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListRoleAssignments(request.Context(), decision.Capability, app.ListRoleAssignments{
		TenantID:    tenantID,
		PrincipalID: principalID,
		RoleName:    roleName,
		ScopeKind:   scopeKind,
		Limit:       limit,
		CursorSort:  cursor.SortValue,
		CursorID:    cursor.ID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}
