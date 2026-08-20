// Package httpadapter exposes Tenant's RLS-protected HTTP workflows.
package httpadapter

import (
	"fmt"
	"net/http"

	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/aethercode/aethercode/libs/pkg/httpauth"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/services/tenant/internal/app"
)

type Handler struct {
	service    *app.Service
	authorizer *httpauth.Authorizer
}

func NewHandler(serviceName string, service *app.Service, readiness httpx.ReadinessFunc, authorizer *httpauth.Authorizer) (http.Handler, error) {
	if service == nil || authorizer == nil {
		return nil, fmt.Errorf("tenant service and authorizer are required")
	}
	handler := &Handler{service: service, authorizer: authorizer}
	mux := httpx.NewOperationalMux(serviceName, readiness)
	mux.HandleFunc("POST /v1/tenants", handler.provisionTenant)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}", handler.getTenant)
	mux.HandleFunc("POST /v1/placement-organizations", handler.createPlacementOrganization)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/departments", handler.createCollegeDepartment)
	mux.HandleFunc("POST /v1/placement-organizations/{organization_id}/departments", handler.createPlacementDepartment)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/batches", handler.createBatch)
	mux.HandleFunc("PUT /v1/tenants/{tenant_id}/retention-policy", handler.setRetentionPolicy)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/legal-holds", handler.placeLegalHold)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/legal-holds/{hold_id}/release", handler.releaseLegalHold)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}", handler.deleteTenant)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/hard", handler.hardDeleteTenant)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/departments/{department_id}", handler.deleteDepartment)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/departments/{department_id}/hard", handler.hardDeleteDepartment)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/batches/{batch_id}", handler.deleteBatch)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/batches/{batch_id}/hard", handler.hardDeleteBatch)
	return mux, nil
}

type provisionTenantRequest struct {
	Slug        string `json:"slug"`
	LegalName   string `json:"legal_name"`
	DisplayName string `json:"display_name"`
}

func (handler *Handler) provisionTenant(writer http.ResponseWriter, request *http.Request) {
	var body provisionTenantRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "tenants", id, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	tenant, err := handler.service.ProvisionTenant(request.Context(), decision.Capability, app.ProvisionTenant{
		ID: id, Slug: body.Slug, LegalName: body.LegalName, DisplayName: body.DisplayName,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, tenant)
}

func (handler *Handler) getTenant(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "tenants", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	tenant, err := handler.service.GetTenant(request.Context(), decision.Capability, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, tenant)
}

type placementOrganizationRequest struct {
	Code      string `json:"code"`
	LegalName string `json:"legal_name"`
}

func (handler *Handler) createPlacementOrganization(writer http.ResponseWriter, request *http.Request) {
	var body placementOrganizationRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "placement_organizations", id, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	organization, err := handler.service.CreatePlacementOrganization(request.Context(), decision.Capability, app.CreatePlacementOrganization{ID: id, Code: body.Code, LegalName: body.LegalName})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, organization)
}

type departmentRequest struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

func (handler *Handler) createCollegeDepartment(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body departmentRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "departments", id, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	department, err := handler.service.CreateCollegeDepartment(request.Context(), decision.Capability, app.CreateCollegeDepartment{ID: id, TenantID: tenantID, Code: body.Code, Name: body.Name})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, department)
}

func (handler *Handler) createPlacementDepartment(writer http.ResponseWriter, request *http.Request) {
	organizationID, err := httpx.ParseUUIDPathValue(request, "organization_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body departmentRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "placement_organizations", organizationID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	department, err := handler.service.CreatePlacementDepartment(request.Context(), decision.Capability, app.CreatePlacementDepartment{ID: id, PlacementOrganizationID: organizationID, Code: body.Code, Name: body.Name})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, department)
}

type batchRequest struct {
	DepartmentID string `json:"department_id"`
	Code         string `json:"code"`
	Name         string `json:"name"`
	AcademicYear string `json:"academic_year"`
}

func (handler *Handler) createBatch(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body batchRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "batches", id, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	batch, err := handler.service.CreateBatch(request.Context(), decision.Capability, app.CreateBatch{ID: id, TenantID: tenantID, DepartmentID: body.DepartmentID, Code: body.Code, Name: body.Name, AcademicYear: body.AcademicYear})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, batch)
}

type retentionRequest struct {
	AcademicRecordsYears     int16 `json:"academic_records_years"`
	AuditRecordsYears        int16 `json:"audit_records_years"`
	AuthLogsDays             int   `json:"auth_logs_days"`
	NotificationDeliveryDays int   `json:"notification_delivery_days"`
	ExecutionRecordDays      int   `json:"execution_record_days"`
}

func (handler *Handler) setRetentionPolicy(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body retentionRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "retention_policies", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	policy, err := handler.service.SetRetentionPolicy(request.Context(), decision.Capability, app.SetRetentionPolicy{TenantID: tenantID, AcademicRecordsYears: body.AcademicRecordsYears, AuditRecordsYears: body.AuditRecordsYears, AuthLogsDays: body.AuthLogsDays, NotificationDeliveryDays: body.NotificationDeliveryDays, ExecutionRecordDays: body.ExecutionRecordDays})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, policy)
}

type legalHoldRequest struct {
	Scope     string `json:"scope"`
	SubjectID string `json:"subject_id"`
	Reason    string `json:"reason"`
}

func (handler *Handler) placeLegalHold(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body legalHoldRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "legal_holds", id, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	hold, err := handler.service.PlaceLegalHold(request.Context(), decision.Capability, app.PlaceLegalHold{ID: id, TenantID: tenantID, Scope: body.Scope, SubjectID: body.SubjectID, Reason: body.Reason, PlacedByPrincipalID: decision.PrincipalID})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, hold)
}

func (handler *Handler) releaseLegalHold(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	holdID, err := httpx.ParseUUIDPathValue(request, "hold_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "legal_holds", holdID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	hold, err := handler.service.ReleaseLegalHold(request.Context(), decision.Capability, app.ReleaseLegalHold{ID: holdID, TenantID: tenantID, ReleasedByPrincipalID: decision.PrincipalID})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, hold)
}

type deleteEntityRequest struct {
	Reason string `json:"reason"`
}

func (handler *Handler) deleteTenant(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body deleteEntityRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "tenants", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.DeleteTenant(request.Context(), decision.Capability, app.DeleteEntity{ID: tenantID, ActorID: decision.PrincipalID, Reason: body.Reason}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) hardDeleteTenant(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body deleteEntityRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "tenants", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.HardDeleteTenant(request.Context(), decision.Capability, app.DeleteEntity{ID: tenantID, ActorID: decision.PrincipalID, Reason: body.Reason}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) deleteDepartment(writer http.ResponseWriter, request *http.Request) {
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
	var body deleteEntityRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "departments", departmentID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.DeleteDepartment(request.Context(), decision.Capability, app.DeleteEntity{ID: departmentID, ActorID: decision.PrincipalID, Reason: body.Reason}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) hardDeleteDepartment(writer http.ResponseWriter, request *http.Request) {
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
	var body deleteEntityRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "departments", departmentID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.HardDeleteDepartment(request.Context(), decision.Capability, app.DeleteEntity{ID: departmentID, ActorID: decision.PrincipalID, Reason: body.Reason}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) deleteBatch(writer http.ResponseWriter, request *http.Request) {
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
	var body deleteEntityRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "batches", batchID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.DeleteBatch(request.Context(), decision.Capability, app.DeleteEntity{ID: batchID, ActorID: decision.PrincipalID, Reason: body.Reason}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) hardDeleteBatch(writer http.ResponseWriter, request *http.Request) {
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
	var body deleteEntityRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "batches", batchID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.HardDeleteBatch(request.Context(), decision.Capability, app.DeleteEntity{ID: batchID, ActorID: decision.PrincipalID, Reason: body.Reason}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}
