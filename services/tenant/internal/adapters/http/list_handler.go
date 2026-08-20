// Package httpadapter implements collection routes, kept separate from the
// mutation surface in handler.go.
package httpadapter

import (
	"net/http"

	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/libs/pkg/pagination"
	"github.com/aethercode/aethercode/services/tenant/internal/app"
)

func (handler *Handler) listTenants(writer http.ResponseWriter, request *http.Request) {
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
	status, err := httpx.ParseEnumQuery(request, "status", "provisioning", "active", "suspended", "closed")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "tenants", "", "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListTenants(request.Context(), decision.Capability, app.ListTenants{
		Limit: limit, CursorSort: cursor.SortValue, CursorID: cursor.ID, Status: status,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

func (handler *Handler) listDepartments(writer http.ResponseWriter, request *http.Request) {
	tenantID, limit, cursor, err := listRequestParts(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	status, err := httpx.ParseEnumQuery(request, "status", "active", "archived")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "departments", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListDepartments(request.Context(), decision.Capability, app.ListDepartments{
		TenantID: tenantID, Limit: limit, CursorSort: cursor.SortValue, CursorID: cursor.ID, Status: status,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

func (handler *Handler) listBatches(writer http.ResponseWriter, request *http.Request) {
	tenantID, limit, cursor, err := listRequestParts(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	status, err := httpx.ParseEnumQuery(request, "status", "active", "archived")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	departmentIDRaw := request.URL.Query().Get("department_id")
	var departmentID string
	if departmentIDRaw != "" {
		if departmentID, err = httpx.ParseUUIDValue(departmentIDRaw, "department_id"); err != nil {
			httpx.WriteError(writer, err)
			return
		}
	}
	academicYear := request.URL.Query().Get("academic_year")
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "batches", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListBatches(request.Context(), decision.Capability, app.ListBatches{
		TenantID: tenantID, Limit: limit, CursorSort: cursor.SortValue, CursorID: cursor.ID,
		Status: status, DepartmentID: departmentID, AcademicYear: academicYear,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

func (handler *Handler) listPlacementDepartments(writer http.ResponseWriter, request *http.Request) {
	organizationID, err := httpx.ParseUUIDPathValue(request, "organization_id")
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
	status, err := httpx.ParseEnumQuery(request, "status", "active", "archived")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "placement_organizations", organizationID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListPlacementDepartments(request.Context(), decision.Capability, app.ListPlacementDepartments{
		OrganizationID: organizationID, Limit: limit, CursorSort: cursor.SortValue, CursorID: cursor.ID, Status: status,
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
