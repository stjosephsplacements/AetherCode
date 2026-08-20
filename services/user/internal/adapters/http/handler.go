// Package httpadapter exposes User's RLS-protected management workflows.
package httpadapter

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/httpauth"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/services/user/internal/app"
)

type Handler struct {
	service    *app.ManagementService
	authorizer *httpauth.Authorizer
}

func NewHandler(serviceName string, service *app.ManagementService, readiness httpx.ReadinessFunc, authorizer *httpauth.Authorizer) (http.Handler, error) {
	if service == nil || authorizer == nil {
		return nil, fmt.Errorf("User management service and authorizer are required")
	}
	handler := &Handler{service: service, authorizer: authorizer}
	mux := httpx.NewOperationalMux(serviceName, readiness)
	mux.HandleFunc("PUT /v1/profiles/{principal_id}", handler.upsertProfile)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/students", handler.enrollStudent)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/students/{student_id}", handler.getStudent)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/students/{student_id}", handler.deleteStudent)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/students/{student_id}/hard", handler.hardDeleteStudent)
	mux.HandleFunc("POST /v1/role-assignments", handler.assignRole)
	mux.HandleFunc("POST /v1/role-assignments/{role_assignment_id}/revoke", handler.revokeRole)
	mux.HandleFunc("PUT /v1/placement-departments/{placement_department_id}/staff/{principal_id}", handler.setPlacementStaffMembership)
	mux.HandleFunc("PUT /v1/tenants/{tenant_id}/batches/{batch_id}/mentors/{principal_id}", handler.assignMentorBatch)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/students/{student_id}/batch-affiliation", handler.getStudentBatchAffiliation)
	mux.HandleFunc("PUT /v1/tenants/{tenant_id}/students/{student_id}/batch-affiliation", handler.setStudentBatchAffiliation)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/students/{student_id}/batch-affiliation/revoke", handler.endStudentBatchAffiliation)
	return mux, nil
}

type profileRequest struct {
	GivenName     string `json:"given_name"`
	FamilyName    string `json:"family_name"`
	PreferredName string `json:"preferred_name"`
}

func (handler *Handler) upsertProfile(writer http.ResponseWriter, request *http.Request) {
	principalID, err := httpx.ParseUUIDPathValue(request, "principal_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	tenantID, err := requiredTenantQuery(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body profileRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "profiles", principalID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	profile, err := handler.service.UpsertProfile(request.Context(), decision.Capability, app.UpsertProfile{
		PrincipalID: principalID, GivenName: body.GivenName, FamilyName: body.FamilyName, PreferredName: body.PreferredName,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, profile)
}

type enrollStudentRequest struct {
	PrincipalID           string `json:"principal_id"`
	EnrollmentNumber      string `json:"enrollment_number"`
	CollegeDepartmentID   string `json:"college_department_id"`
	PlacementDepartmentID string `json:"placement_department_id"`
}

func (handler *Handler) enrollStudent(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body enrollStudentRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	principalID, err := httpx.ParseUUIDValue(body.PrincipalID, "principal_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	collegeDepartmentID, err := httpx.ParseUUIDValue(body.CollegeDepartmentID, "college_department_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	placementDepartmentID, err := httpx.ParseUUIDValue(body.PlacementDepartmentID, "placement_department_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	studentID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	collegeMembershipID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	placementMembershipID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	studentRoleID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "students", studentID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	student, err := handler.service.EnrollStudent(request.Context(), decision.Capability, app.EnrollStudent{
		ID: studentID, PrincipalID: principalID, TenantID: tenantID,
		EnrollmentNumber: body.EnrollmentNumber, CollegeDepartmentID: collegeDepartmentID,
		PlacementDepartmentID: placementDepartmentID, CollegeMembershipID: collegeMembershipID,
		PlacementMembershipID: placementMembershipID, GrantedStudentRoleID: studentRoleID,
		CreatedByPrincipalID: decision.PrincipalID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, student)
}

func (handler *Handler) getStudent(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	studentID, err := httpx.ParseUUIDPathValue(request, "student_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "students", studentID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	student, err := handler.service.GetStudent(request.Context(), decision.Capability, studentID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, student)
}

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

type placementStaffRequest struct {
	TenantID  string `json:"tenant_id"`
	ExpiresAt string `json:"expires_at"`
}

func (handler *Handler) setPlacementStaffMembership(writer http.ResponseWriter, request *http.Request) {
	placementDepartmentID, err := httpx.ParseUUIDPathValue(request, "placement_department_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	principalID, err := httpx.ParseUUIDPathValue(request, "principal_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body placementStaffRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	tenantID, err := optionalTenant(body.TenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
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
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "placement_department_memberships", id, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	membership, err := handler.service.SetPlacementStaffMembership(request.Context(), decision.Capability, app.SetPlacementStaffMembership{
		ID: id, PrincipalID: principalID, PlacementDepartmentID: placementDepartmentID, ExpiresAt: expiresAt,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, membership)
}

func (handler *Handler) assignMentorBatch(writer http.ResponseWriter, request *http.Request) {
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
	principalID, err := httpx.ParseUUIDPathValue(request, "principal_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "mentor_batch_assignments", id, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	assignment, err := handler.service.AssignMentorBatch(request.Context(), decision.Capability, app.AssignMentorBatch{
		ID: id, MentorPrincipalID: principalID, TenantID: tenantID, BatchID: batchID,
		AssignedByPrincipalID: decision.PrincipalID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, assignment)
}

type setStudentBatchAffiliationRequest struct {
	BatchID         string `json:"batch_id"`
	ExpectedVersion int    `json:"expected_version"`
}

func (handler *Handler) getStudentBatchAffiliation(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	studentID, err := httpx.ParseUUIDPathValue(request, "student_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "student_batch_affiliations", studentID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	affiliation, err := handler.service.GetStudentBatchAffiliation(request.Context(), decision.Capability, app.GetStudentBatchAffiliation{
		TenantID: tenantID, StudentID: studentID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, affiliation)
}

func (handler *Handler) setStudentBatchAffiliation(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	studentID, err := httpx.ParseUUIDPathValue(request, "student_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body setStudentBatchAffiliationRequest
	rawBody, err := httpx.DecodeJSONRaw(request, &body)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	idempotencyKey, err := requiredIdempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	batchID, err := httpx.ParseUUIDValue(body.BatchID, "batch_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	membershipID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "student_batch_affiliations", studentID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	requestChecksum := sha256.Sum256(rawBody)
	affiliation, err := handler.service.SetStudentBatchAffiliation(request.Context(), decision.Capability, app.SetStudentBatchAffiliation{
		MembershipID: membershipID, TenantID: tenantID, StudentID: studentID,
		BatchID: batchID, ExpectedVersion: body.ExpectedVersion,
		ActorID: decision.PrincipalID, IdempotencyKey: idempotencyKey, RequestChecksum: requestChecksum[:],
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, affiliation)
}

type endStudentBatchAffiliationRequest struct {
	ExpectedVersion int `json:"expected_version"`
}

func (handler *Handler) endStudentBatchAffiliation(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	studentID, err := httpx.ParseUUIDPathValue(request, "student_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body endStudentBatchAffiliationRequest
	rawBody, err := httpx.DecodeJSONRaw(request, &body)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	idempotencyKey, err := requiredIdempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "student_batch_affiliations", studentID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	requestChecksum := sha256.Sum256(rawBody)
	affiliation, err := handler.service.EndStudentBatchAffiliation(request.Context(), decision.Capability, app.EndStudentBatchAffiliation{
		TenantID: tenantID, StudentID: studentID, ExpectedVersion: body.ExpectedVersion,
		ActorID: decision.PrincipalID, IdempotencyKey: idempotencyKey, RequestChecksum: requestChecksum[:],
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, affiliation)
}

func requiredTenantQuery(request *http.Request) (string, error) {
	return httpx.ParseUUIDValue(request.URL.Query().Get("tenant_id"), "tenant_id")
}

func optionalTenant(raw string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return "", nil
	}
	return httpx.ParseUUIDValue(raw, "tenant_id")
}

func parseOptionalExpiry(raw string) (*time.Time, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(raw))
	if err != nil || !parsed.After(time.Now().UTC()) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "expires_at must be a future RFC3339 timestamp")
	}
	value := parsed.UTC()
	return &value, nil
}

func requiredIdempotencyKey(request *http.Request) (string, error) {
	key := strings.TrimSpace(request.Header.Get("Idempotency-Key"))
	if key == "" {
		return "", apperrors.New(apperrors.CodeInvalidArgument, "Idempotency-Key header is required")
	}
	return httpx.ParseUUIDValue(key, "Idempotency-Key")
}

type deleteStudentRequest struct {
	Reason string `json:"reason"`
}

func (handler *Handler) deleteStudent(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	studentID, err := httpx.ParseUUIDPathValue(request, "student_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body deleteStudentRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "students", studentID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.DeleteStudent(request.Context(), decision.Capability, app.DeleteStudent{
		ID:      studentID,
		ActorID: decision.PrincipalID,
		Reason:  body.Reason,
	}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) hardDeleteStudent(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	studentID, err := httpx.ParseUUIDPathValue(request, "student_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body deleteStudentRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "students", studentID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.HardDeleteStudent(request.Context(), decision.Capability, app.DeleteStudent{
		ID:      studentID,
		ActorID: decision.PrincipalID,
		Reason:  body.Reason,
	}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}
