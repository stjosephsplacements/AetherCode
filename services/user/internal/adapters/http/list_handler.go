// Package httpadapter collection routes. Kept separate from handler.go so the
// mutation surface stays readable as the read surface grows.
package httpadapter

import (
	"net/http"
	"strings"

	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/libs/pkg/pagination"
	"github.com/aethercode/aethercode/services/user/internal/app"
)

func (handler *Handler) listStudents(writer http.ResponseWriter, request *http.Request) {
	tenantID, limit, cursor, err := listRequestParts(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	status, err := httpx.ParseEnumQuery(request, "status",
		"pending", "active", "inactive", "withdrawn")
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
	departmentID := strings.TrimSpace(request.URL.Query().Get("department_id"))
	if departmentID != "" {
		departmentID, err = httpx.ParseUUIDValue(departmentID, "department_id")
		if err != nil {
			httpx.WriteError(writer, err)
			return
		}
	}
	enrollmentPrefix := request.URL.Query().Get("enrollment_number_prefix")
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "students", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListStudents(request.Context(), decision.Capability, app.ListStudents{
		TenantID:               tenantID,
		Limit:                  limit,
		CursorSort:             cursor.SortValue,
		CursorID:               cursor.ID,
		Status:                 status,
		BatchID:                batchID,
		DepartmentID:           departmentID,
		EnrollmentNumberPrefix: enrollmentPrefix,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

func (handler *Handler) listMentorBatchAssignments(writer http.ResponseWriter, request *http.Request) {
	tenantID, limit, cursor, err := listRequestParts(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	batchID, err := httpx.ParseUUIDPathValue(request, "batch_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "mentor_batch_assignments", batchID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListMentorBatchAssignments(request.Context(), decision.Capability, app.ListMentorBatchAssignments{
		TenantID:   tenantID,
		BatchID:    batchID,
		Limit:      limit,
		CursorSort: cursor.SortValue,
		CursorID:   cursor.ID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
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
	// Resource ID for the authorization check is the principal filter when
	// present; otherwise empty so a staff-wide scope can cover the resource.
	principalFilterOrTenant := principalID
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

// listRequestParts parses the tenant path value and the two pagination
// parameters shared by collection routes that carry {tenant_id} in the path.
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
