// Package httpadapter collection routes, kept separate from the mutation
// surface in handler.go.
package httpadapter

import (
	"net/http"

	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/libs/pkg/pagination"
	"github.com/aethercode/aethercode/services/seb/internal/app"
)

func (handler *Handler) listSessions(writer http.ResponseWriter, request *http.Request) {
	tenantID, limit, cursor, err := listRequestParts(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	lifecycleState, err := httpx.ParseEnumQuery(request, "lifecycle_state",
		"issued", "active", "closed", "revoked", "expired")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	// Candidate collection: the bearer subject is the authorization resource and
	// SEB binds rows to sessions.candidate_id in the database.
	decision, err := handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, "read", "sessions", tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListSessions(request.Context(), decision.Capability, app.ListSessions{
		TenantID: tenantID, Limit: limit,
		CursorSort: cursor.SortValue, CursorID: cursor.ID,
		LifecycleState: lifecycleState,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

func (handler *Handler) listConfigurations(writer http.ResponseWriter, request *http.Request) {
	tenantID, limit, cursor, err := listRequestParts(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	lifecycleState, err := httpx.ParseEnumQuery(request, "lifecycle_state", "active", "retired", "revoked")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "configurations", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListConfigurations(request.Context(), decision.Capability, app.ListConfigurations{
		TenantID: tenantID, Limit: limit,
		CursorSort: cursor.SortValue, CursorID: cursor.ID,
		LifecycleState: lifecycleState,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

// listRequestParts parses the tenant path value and the two pagination
// parameters shared by every collection route in this service.
func listRequestParts(request *http.Request) (string, int, pagination.Cursor, error) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		return "", 0, pagination.Cursor{}, err
	}
	limit, err := pagination.ParseLimit(request.URL.Query().Get("limit"), 20, 100)
	if err != nil {
		return "", 0, pagination.Cursor{}, err
	}
	cursor, _, err := pagination.Parse(request.URL.Query().Get("cursor"))
	if err != nil {
		return "", 0, pagination.Cursor{}, err
	}
	return tenantID, limit, cursor, nil
}
