// Package httpadapter collection routes. Kept separate from handler.go so the
// mutation surface stays readable as the read surface grows.
package httpadapter

import (
	"net/http"

	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/libs/pkg/pagination"
	"github.com/aethercode/aethercode/services/assessment/internal/app"
)

func (handler *Handler) listCandidateAssignments(writer http.ResponseWriter, request *http.Request) {
	tenantID, limit, cursor, err := listRequestParts(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	lifecycleState, err := httpx.ParseEnumQuery(request, "lifecycle_state",
		"assigned", "revoked", "started", "completed", "expired")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	// Candidate collection: the bearer subject is the authorization resource and
	// Assessment binds rows to the signed actor in the database.
	decision, err := handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, "read", "candidate_assignments", tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListCandidateAssignments(request.Context(), decision.Capability, app.ListCandidateAssignments{
		TenantID:       tenantID,
		Limit:          limit,
		CursorSort:     cursor.SortValue,
		CursorID:       cursor.ID,
		LifecycleState: lifecycleState,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

func (handler *Handler) listExams(writer http.ResponseWriter, request *http.Request) {
	tenantID, limit, cursor, err := listRequestParts(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	lifecycleState, err := httpx.ParseEnumQuery(request, "lifecycle_state",
		"draft", "published", "archived")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "exams", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListExams(request.Context(), decision.Capability, app.ListExams{
		TenantID:       tenantID,
		Limit:          limit,
		CursorSort:     cursor.SortValue,
		CursorID:       cursor.ID,
		LifecycleState: lifecycleState,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

func (handler *Handler) listExamVersions(writer http.ResponseWriter, request *http.Request) {
	tenantID, limit, cursor, err := listRequestParts(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	examID, err := httpx.ParseUUIDPathValue(request, "exam_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	status, err := httpx.ParseEnumQuery(request, "status", "draft", "published", "retired")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "exam_versions", examID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListExamVersions(request.Context(), decision.Capability, app.ListExamVersions{
		TenantID:   tenantID,
		ExamID:     examID,
		Limit:      limit,
		CursorSort: cursor.SortValue,
		CursorID:   cursor.ID,
		Status:     status,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

func (handler *Handler) listProctorPolicies(writer http.ResponseWriter, request *http.Request) {
	tenantID, limit, cursor, err := listRequestParts(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	lifecycleState, err := httpx.ParseEnumQuery(request, "lifecycle_state",
		"draft", "active", "archived")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "proctor_policies", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListProctorPolicies(request.Context(), decision.Capability, app.ListProctorPolicies{
		TenantID:       tenantID,
		Limit:          limit,
		CursorSort:     cursor.SortValue,
		CursorID:       cursor.ID,
		LifecycleState: lifecycleState,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

func (handler *Handler) listProctorPolicyVersions(writer http.ResponseWriter, request *http.Request) {
	tenantID, limit, cursor, err := listRequestParts(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	policyID, err := httpx.ParseUUIDPathValue(request, "proctor_policy_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	status, err := httpx.ParseEnumQuery(request, "status", "draft", "published")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "proctor_policy_versions", policyID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListProctorPolicyVersions(request.Context(), decision.Capability, app.ListProctorPolicyVersions{
		TenantID:        tenantID,
		ProctorPolicyID: policyID,
		Limit:           limit,
		CursorSort:      cursor.SortValue,
		CursorID:        cursor.ID,
		Status:          status,
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
