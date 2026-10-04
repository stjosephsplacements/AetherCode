package httpadapter

import (
	"context"
	"net/http"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/services/user/internal/app"
)

type importStudentsRequest struct {
	BatchID               string           `json:"batch_id"`
	CollegeDepartmentID   string           `json:"college_department_id"`
	PlacementDepartmentID string           `json:"placement_department_id"`
	Students              []app.StudentRow `json:"students"`
}

func (handler *Handler) importStudents(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body importStudentsRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	batchID, err := httpx.ParseUUIDValue(body.BatchID, "batch_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	authorize, actorID, err := handler.accountAuthorizer(request, batchID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	result, err := handler.accounts.ImportStudents(request.Context(), authorize, actorID, app.StudentImport{
		TenantID: tenantID, BatchID: batchID, CollegeDepartmentID: body.CollegeDepartmentID,
		PlacementDepartmentID: body.PlacementDepartmentID, Students: body.Students,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writeCredentials(writer, http.StatusCreated, result)
}

func (handler *Handler) reissueBatchPasswords(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	batchID, err := httpx.ParseUUIDPathValue(request, "batch_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	authorize, actorID, err := handler.accountAuthorizer(request, batchID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	credentials, err := handler.accounts.ReissueBatchPasswords(request.Context(), authorize, actorID, tenantID, batchID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writeCredentials(writer, http.StatusOK, struct {
		Accounts []app.IssuedCredential `json:"accounts"`
	}{Accounts: credentials})
}

func (handler *Handler) resetAccountPassword(writer http.ResponseWriter, request *http.Request) {
	tenantID, principalID, authorize, actorID, ok := handler.accountTarget(writer, request)
	if !ok {
		return
	}
	credential, err := handler.accounts.ResetPassword(request.Context(), authorize, actorID, tenantID, principalID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writeCredentials(writer, http.StatusOK, credential)
}

func (handler *Handler) setAccountStatus(writer http.ResponseWriter, request *http.Request) {
	var body struct {
		Status string `json:"status"`
	}
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	tenantID, principalID, authorize, actorID, ok := handler.accountTarget(writer, request)
	if !ok {
		return
	}
	if err := handler.accounts.SetAccountStatus(request.Context(), authorize, actorID, tenantID, principalID, body.Status); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

type createStaffRequest struct {
	Username     string `json:"username"`
	Email        string `json:"email"`
	DisplayName  string `json:"display_name"`
	Role         string `json:"role"`
	DepartmentID string `json:"department_id"`
}

func (handler *Handler) createStaff(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body createStaffRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	authorize, actorID, err := handler.accountAuthorizer(request, tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	result, err := handler.accounts.CreateStaff(request.Context(), authorize, actorID, app.StaffAccount{
		TenantID: tenantID, Username: body.Username, Email: body.Email, DisplayName: body.DisplayName,
		Role: body.Role, DepartmentID: body.DepartmentID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writeCredentials(writer, http.StatusCreated, result)
}

// accountTarget parses /tenants/{tenant_id}/accounts/{principal_id} and
// authorizes users.accounts writes on that principal.
func (handler *Handler) accountTarget(writer http.ResponseWriter, request *http.Request) (string, string, app.Authorize, string, bool) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return "", "", nil, "", false
	}
	principalID, err := httpx.ParseUUIDPathValue(request, "principal_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return "", "", nil, "", false
	}
	authorize, actorID, err := handler.accountAuthorizer(request, principalID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return "", "", nil, "", false
	}
	return tenantID, principalID, authorize, actorID, true
}

// accountAuthorizer makes the central decision up front, so nothing happens
// for an unauthorized caller, and returns the actor plus an Authorize that
// hands out that decision's capability first and fresh ones after it.
func (handler *Handler) accountAuthorizer(request *http.Request, resourceID, tenantID string) (app.Authorize, string, error) {
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "accounts", resourceID, tenantID)
	if err != nil {
		return nil, "", err
	}
	first := &decision.Capability
	return func(contextValue context.Context) (centralauthz.Capability, error) {
		if first != nil {
			capability := *first
			first = nil
			return capability, nil
		}
		next, err := handler.authorizer.AuthorizeHTTP(contextValue, request, "write", "accounts", resourceID, tenantID)
		return next.Capability, err
	}, decision.PrincipalID, nil
}

// writeCredentials sends a body that contains generated passwords; it must
// never be cached by a browser or proxy.
func writeCredentials(writer http.ResponseWriter, status int, body any) {
	writer.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(writer, status, body)
}
