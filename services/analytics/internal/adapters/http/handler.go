// Package httpadapter exposes protected Analytics reporting routes.
package httpadapter

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/httpauth"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/services/analytics/internal/app"
)

type Handler struct {
	service    *app.Service
	authorizer *httpauth.Authorizer
}

func NewHandler(serviceName string, service *app.Service, readiness httpx.ReadinessFunc, authorizer *httpauth.Authorizer) (http.Handler, error) {
	if service == nil || authorizer == nil {
		return nil, fmt.Errorf("analytics service and authorizer are required")
	}
	handler := &Handler{service: service, authorizer: authorizer}
	mux := httpx.NewOperationalMux(serviceName, readiness)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/student-progress/{student_id}", handler.listStudentProgress)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/exam-results", handler.listExamResults)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/batch-progress/{batch_id}", handler.listBatchProgress)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/placement-progress/{placement_department_id}", handler.listPlacementProgress)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/report-exports", handler.requestReportExport)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/report-exports/{export_id}", handler.getReportExport)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/report-exports/{export_id}", handler.deleteReportExport)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/report-exports/{export_id}/hard", handler.hardDeleteReportExport)
	return mux, nil
}

func (handler *Handler) listStudentProgress(writer http.ResponseWriter, request *http.Request) {
	tenantID, studentID, limit, err := tenantResourceAndLimit(request, "student_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "student_progress_rollups", studentID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	result, err := handler.service.ListStudentProgress(request.Context(), decision.Capability, tenantID, studentID, limit)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, result)
}

func (handler *Handler) listExamResults(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	examVersionID, err := httpx.ParseUUIDValue(request.URL.Query().Get("exam_version_id"), "exam_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	limit, err := parseLimit(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "exam_result_rollups", examVersionID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	result, err := handler.service.ListExamResults(request.Context(), decision.Capability, tenantID, examVersionID, limit)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, result)
}

func (handler *Handler) listBatchProgress(writer http.ResponseWriter, request *http.Request) {
	tenantID, batchID, limit, err := tenantResourceAndLimit(request, "batch_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "batch_progress_rollups", batchID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	result, err := handler.service.ListBatchProgress(request.Context(), decision.Capability, tenantID, batchID, limit)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, result)
}

func (handler *Handler) listPlacementProgress(writer http.ResponseWriter, request *http.Request) {
	tenantID, placementDepartmentID, limit, err := tenantResourceAndLimit(request, "placement_department_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "placement_student_rollups", placementDepartmentID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	result, err := handler.service.ListPlacementProgress(request.Context(), decision.Capability, tenantID, placementDepartmentID, limit)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, result)
}

type reportExportRequest struct {
	ReportType app.ReportType  `json:"report_type"`
	Filters    json.RawMessage `json:"filters"`
}

func (handler *Handler) requestReportExport(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body reportExportRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if len(body.Filters) == 0 {
		httpx.WriteError(writer, apperrors.New(apperrors.CodeInvalidArgument, "filters must be a JSON object"))
		return
	}
	idempotencyKey, err := requiredIdempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	exportID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	eventID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "report_exports", exportID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	result, err := handler.service.RequestReportExport(request.Context(), decision.Capability, app.RequestReportExport{
		ID: exportID, EventID: eventID, TenantID: tenantID, ReportType: body.ReportType,
		Filters: body.Filters, IdempotencyKey: idempotencyKey,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusAccepted, result)
}

func (handler *Handler) getReportExport(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	exportID, err := httpx.ParseUUIDPathValue(request, "export_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "report_exports", exportID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	result, err := handler.service.GetReportExport(request.Context(), decision.Capability, tenantID, exportID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, result)
}

func tenantResourceAndLimit(request *http.Request, resourceName string) (string, string, int, error) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		return "", "", 0, err
	}
	resourceID, err := httpx.ParseUUIDPathValue(request, resourceName)
	if err != nil {
		return "", "", 0, err
	}
	limit, err := parseLimit(request)
	if err != nil {
		return "", "", 0, err
	}
	return tenantID, resourceID, limit, nil
}

func parseLimit(request *http.Request) (int, error) {
	raw := strings.TrimSpace(request.URL.Query().Get("limit"))
	if raw == "" {
		return 0, nil
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 || limit > 500 {
		return 0, apperrors.New(apperrors.CodeInvalidArgument, "limit must be an integer between 1 and 500")
	}
	return limit, nil
}

func requiredIdempotencyKey(request *http.Request) (string, error) {
	key := strings.TrimSpace(request.Header.Get("Idempotency-Key"))
	if key == "" || len(key) > 255 {
		return "", apperrors.New(apperrors.CodeInvalidArgument, "Idempotency-Key header is required and must be at most 255 characters")
	}
	return key, nil
}

type deleteReportExportRequest struct {
	Reason string `json:"reason"`
}

func (handler *Handler) deleteReportExport(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	exportID, err := httpx.ParseUUIDPathValue(request, "export_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body deleteReportExportRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "report_exports", exportID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.DeleteReportExportByID(request.Context(), decision.Capability, app.DeleteReportExport{ID: exportID, TenantID: tenantID, ActorID: decision.PrincipalID, Reason: body.Reason}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) hardDeleteReportExport(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	exportID, err := httpx.ParseUUIDPathValue(request, "export_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body deleteReportExportRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "report_exports", exportID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.HardDeleteReportExportByID(request.Context(), decision.Capability, app.DeleteReportExport{ID: exportID, TenantID: tenantID, ActorID: decision.PrincipalID, Reason: body.Reason}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}
