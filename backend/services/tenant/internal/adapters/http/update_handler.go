package httpadapter

import (
	"net/http"

	"github.com/stjosephsplacements/AetherCode/libs/pkg/httpx"
	"github.com/stjosephsplacements/AetherCode/services/tenant/internal/app"
)

// Updates are PATCHes: only the fields in the body change.

type updateTenantRequest struct {
	LegalName   *string `json:"legal_name"`
	DisplayName *string `json:"display_name"`
}

func (handler *Handler) updateTenant(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body updateTenantRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "tenants", tenantID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	tenant, err := handler.service.UpdateTenant(request.Context(), decision.Capability, app.UpdateTenant{ID: tenantID, LegalName: body.LegalName, DisplayName: body.DisplayName})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, tenant)
}

type updateDepartmentRequest struct {
	Code *string `json:"code"`
	Name *string `json:"name"`
}

func (handler *Handler) updateDepartment(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	departmentID, err := httpx.ParseUUIDPathValue(request, "department_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body updateDepartmentRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "departments", departmentID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	department, err := handler.service.UpdateDepartment(request.Context(), decision.Capability, app.UpdateDepartment{ID: departmentID, Code: body.Code, Name: body.Name})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, department)
}

type updateBatchRequest struct {
	Code         *string `json:"code"`
	Name         *string `json:"name"`
	AcademicYear *string `json:"academic_year"`
}

func (handler *Handler) updateBatch(writer http.ResponseWriter, request *http.Request) {
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
	var body updateBatchRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "batches", batchID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	batch, err := handler.service.UpdateBatch(request.Context(), decision.Capability, app.UpdateBatch{ID: batchID, Code: body.Code, Name: body.Name, AcademicYear: body.AcademicYear})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, batch)
}
