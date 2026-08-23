// Package httpadapter exposes Assessment's concrete RLS-protected workflows.
package httpadapter

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/httpauth"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/services/assessment/internal/app"
)

// appService is the subset of *app.Service methods consumed by Handler.
// Defining an interface here keeps the handler testable without a real database.
type appService interface {
	CreateProctorPolicy(context.Context, centralauthz.Capability, app.CreateProctorPolicy) (app.ProctorPolicy, error)
	CreateProctorPolicyVersion(context.Context, centralauthz.Capability, app.CreateProctorPolicyVersion) (app.ProctorPolicyVersion, error)
	PublishProctorPolicyVersion(context.Context, centralauthz.Capability, app.PublishProctorPolicyVersion) (app.ProctorPolicyVersion, error)
	GetProctorPolicy(context.Context, centralauthz.Capability, string, string) (app.ProctorPolicy, error)
	GetProctorPolicyVersion(context.Context, centralauthz.Capability, string, string) (app.ProctorPolicyVersion, error)
	ListProctorPolicies(context.Context, centralauthz.Capability, app.ListProctorPolicies) (app.Page[app.ProctorPolicy], error)
	ListProctorPolicyVersions(context.Context, centralauthz.Capability, app.ListProctorPolicyVersions) (app.Page[app.ProctorPolicyVersion], error)
	CreateExam(context.Context, centralauthz.Capability, app.CreateExam) (app.Exam, error)
	GetExam(context.Context, centralauthz.Capability, string, string) (app.Exam, error)
	UpdateExam(context.Context, centralauthz.Capability, app.UpdateExam) (app.Exam, error)
	DeleteExam(context.Context, centralauthz.Capability, app.DeleteExam) error
	HardDeleteExam(context.Context, centralauthz.Capability, app.DeleteExam) error
	CreateExamVersion(context.Context, centralauthz.Capability, app.CreateExamVersion) (app.ExamVersion, error)
	GetExamVersion(context.Context, centralauthz.Capability, app.GetExamVersion) (app.ExamVersion, error)
	AddExamSection(context.Context, centralauthz.Capability, app.AddExamSection) (app.ExamSection, error)
	AddExamItem(context.Context, centralauthz.Capability, app.AddExamItem) (app.ExamItem, error)
	RemoveExamSection(context.Context, centralauthz.Capability, app.RemoveExamSection) error
	RemoveExamItem(context.Context, centralauthz.Capability, app.RemoveExamItem) error
	PublishExamVersion(context.Context, centralauthz.Capability, app.PublishExamVersion) (app.ExamVersion, error)
	CreateAssignmentRule(context.Context, centralauthz.Capability, app.CreateAssignmentRule) (app.AssignmentRule, error)
	MaterializeDirectCandidateAssignment(context.Context, centralauthz.Capability, app.MaterializeDirectCandidateAssignment) (app.CandidateAssignment, error)
	RevokeCandidateAssignment(context.Context, centralauthz.Capability, app.RevokeCandidateAssignment) (app.CandidateAssignment, error)
	GetCandidateAssignment(context.Context, centralauthz.Capability, app.GetCandidateAssignment) (app.CandidateAssignment, error)
	ListCandidateAssignments(context.Context, centralauthz.Capability, app.ListCandidateAssignments) (app.Page[app.CandidateAssignment], error)
	ListExams(context.Context, centralauthz.Capability, app.ListExams) (app.Page[app.Exam], error)
	ListExamVersions(context.Context, centralauthz.Capability, app.ListExamVersions) (app.Page[app.ExamVersion], error)
}

// httpAuthorizer is the subset of *httpauth.Authorizer methods consumed by Handler.
type httpAuthorizer interface {
	AuthorizeHTTP(context.Context, *http.Request, string, string, string, string) (httpauth.Decision, error)
	AuthorizeSelfHTTP(context.Context, *http.Request, string, string, string) (httpauth.Decision, error)
}

type Handler struct {
	service    appService
	authorizer httpAuthorizer
}

func NewHandler(serviceName string, service *app.Service, readiness httpx.ReadinessFunc, authorizer *httpauth.Authorizer) (http.Handler, error) {
	if service == nil || authorizer == nil {
		return nil, fmt.Errorf("assessment service and authorizer are required")
	}
	handler := &Handler{service: service, authorizer: authorizer}
	mux := httpx.NewOperationalMux(serviceName, readiness)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/proctor-policies", handler.createProctorPolicy)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/proctor-policies", handler.listProctorPolicies)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/proctor-policies/{proctor_policy_id}", handler.getProctorPolicy)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/proctor-policies/{proctor_policy_id}/versions", handler.createProctorPolicyVersion)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/proctor-policies/{proctor_policy_id}/versions", handler.listProctorPolicyVersions)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/proctor-policy-versions/{proctor_policy_version_id}/publish", handler.publishProctorPolicyVersion)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/proctor-policy-versions/{proctor_policy_version_id}", handler.getProctorPolicyVersion)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/exams", handler.createExam)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/exams/{exam_id}", handler.getExam)
	mux.HandleFunc("PATCH /v1/tenants/{tenant_id}/exams/{exam_id}", handler.updateExam)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/exams/{exam_id}", handler.deleteExam)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/exams/{exam_id}/hard", handler.hardDeleteExam)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/exams/{exam_id}/versions", handler.createExamVersion)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/exam-versions/{exam_version_id}", handler.getExamVersion)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/sections", handler.addExamSection)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/sections/{section_id}/items", handler.addExamItem)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/sections/{section_id}", handler.removeExamSection)
	mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/sections/{section_id}/items/{item_id}", handler.removeExamItem)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/publish", handler.publishExamVersion)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/assignment-rules", handler.createAssignmentRule)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/assignment-rules/{assignment_rule_id}/candidate-assignments", handler.materializeDirectCandidateAssignment)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/candidate-assignments/{candidate_assignment_id}/revoke", handler.revokeCandidateAssignment)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/candidate-assignments/{candidate_assignment_id}", handler.getCandidateAssignment)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/candidate-assignments", handler.listCandidateAssignments)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/exams", handler.listExams)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/exams/{exam_id}/versions", handler.listExamVersions)
	return mux, nil
}

type createProctorPolicyRequest struct {
	Name string `json:"name"`
}

func (handler *Handler) createProctorPolicy(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body createProctorPolicyRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "proctor_policies", id, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	policy, err := handler.service.CreateProctorPolicy(request.Context(), decision.Capability, app.CreateProctorPolicy{WriteCommand: app.WriteCommand{IdempotencyKey: key}, ID: id, TenantID: tenantID, Name: body.Name})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, policy)
}

type createProctorPolicyVersionRequest struct {
	ExpectedPolicyVersion int64           `json:"expected_policy_version"`
	Policy                json.RawMessage `json:"policy"`
}

func (handler *Handler) createProctorPolicyVersion(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	proctorPolicyID, err := httpx.ParseUUIDPathValue(request, "proctor_policy_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body createProctorPolicyVersionRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "proctor_policy_versions", id, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	policyVersion, err := handler.service.CreateProctorPolicyVersion(request.Context(), decision.Capability, app.CreateProctorPolicyVersion{
		WriteCommand: app.WriteCommand{IdempotencyKey: key}, ID: id, TenantID: tenantID, ProctorPolicyID: proctorPolicyID,
		ExpectedPolicyVersion: body.ExpectedPolicyVersion, Policy: body.Policy,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, policyVersion)
}

func (handler *Handler) publishProctorPolicyVersion(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	versionID, err := httpx.ParseUUIDPathValue(request, "proctor_policy_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "proctor_policy_versions", versionID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	policyVersion, err := handler.service.PublishProctorPolicyVersion(request.Context(), decision.Capability, app.PublishProctorPolicyVersion{WriteCommand: app.WriteCommand{IdempotencyKey: key}, TenantID: tenantID, ProctorPolicyVersionID: versionID})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, policyVersion)
}

type createExamRequest struct {
	ExternalReference string `json:"external_reference"`
}

func (handler *Handler) createExam(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body createExamRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "exams", id, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	exam, err := handler.service.CreateExam(request.Context(), decision.Capability, app.CreateExam{WriteCommand: app.WriteCommand{IdempotencyKey: key}, ID: id, TenantID: tenantID, ExternalReference: body.ExternalReference})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, exam)
}

type createExamVersionRequest struct {
	ExpectedExamVersion    int64     `json:"expected_exam_version"`
	Title                  string    `json:"title"`
	InstructionsMarkdown   string    `json:"instructions_markdown"`
	OpensAt                time.Time `json:"opens_at"`
	ClosesAt               time.Time `json:"closes_at"`
	DurationSeconds        int       `json:"duration_seconds"`
	ProctorPolicyVersionID string    `json:"proctor_policy_version_id"`
}

func (handler *Handler) createExamVersion(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	examID, err := httpx.ParseUUIDPathValue(request, "exam_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body createExamVersionRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "exam_versions", id, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	examVersion, err := handler.service.CreateExamVersion(request.Context(), decision.Capability, app.CreateExamVersion{
		WriteCommand: app.WriteCommand{IdempotencyKey: key}, ID: id, TenantID: tenantID, ExamID: examID, ExpectedExamVersion: body.ExpectedExamVersion,
		Title: body.Title, InstructionsMarkdown: body.InstructionsMarkdown, OpensAt: body.OpensAt,
		ClosesAt: body.ClosesAt, DurationSeconds: body.DurationSeconds,
		ProctorPolicyVersionID: body.ProctorPolicyVersionID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, examVersion)
}

func (handler *Handler) getExamVersion(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	versionID, err := httpx.ParseUUIDPathValue(request, "exam_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "exam_versions", versionID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	examVersion, err := handler.service.GetExamVersion(request.Context(), decision.Capability, app.GetExamVersion{TenantID: tenantID, ExamVersionID: versionID})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, examVersion)
}

type addExamSectionRequest struct {
	ExpectedContentVersion int64  `json:"expected_content_version"`
	Position               int    `json:"position"`
	Title                  string `json:"title"`
	InstructionsMarkdown   string `json:"instructions_markdown"`
	TimeLimitSeconds       *int   `json:"time_limit_seconds"`
}

func (handler *Handler) addExamSection(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	versionID, err := httpx.ParseUUIDPathValue(request, "exam_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body addExamSectionRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "exam_sections", id, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	section, err := handler.service.AddExamSection(request.Context(), decision.Capability, app.AddExamSection{
		WriteCommand: app.WriteCommand{IdempotencyKey: key}, ID: id, TenantID: tenantID, ExamVersionID: versionID, ExpectedContentVersion: body.ExpectedContentVersion,
		Position: body.Position, Title: body.Title, InstructionsMarkdown: body.InstructionsMarkdown,
		TimeLimitSeconds: body.TimeLimitSeconds,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, section)
}

type addExamItemRequest struct {
	ExpectedContentVersion    int64  `json:"expected_content_version"`
	Position                  int    `json:"position"`
	QuestionID                string `json:"question_id"`
	QuestionVersionID         string `json:"question_version_id"`
	MaximumScore              string `json:"maximum_score"`
	EvaluationBundleObjectKey string `json:"evaluation_bundle_object_key"`
	EvaluationBundleChecksum  string `json:"evaluation_bundle_checksum"`
}

func (handler *Handler) addExamItem(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	versionID, err := httpx.ParseUUIDPathValue(request, "exam_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	sectionID, err := httpx.ParseUUIDPathValue(request, "section_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body addExamItemRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "exam_items", id, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	item, err := handler.service.AddExamItem(request.Context(), decision.Capability, app.AddExamItem{
		WriteCommand: app.WriteCommand{IdempotencyKey: key}, ID: id, TenantID: tenantID, ExamVersionID: versionID, SectionID: sectionID,
		ExpectedContentVersion: body.ExpectedContentVersion, Position: body.Position,
		QuestionID: body.QuestionID, QuestionVersionID: body.QuestionVersionID,
		MaximumScore: body.MaximumScore, EvaluationBundleObjectKey: body.EvaluationBundleObjectKey,
		EvaluationBundleChecksum: body.EvaluationBundleChecksum,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, item)
}

type removeExamSectionRequest struct {
	ExpectedContentVersion int64 `json:"expected_content_version"`
}

func (handler *Handler) removeExamSection(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	versionID, err := httpx.ParseUUIDPathValue(request, "exam_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	sectionID, err := httpx.ParseUUIDPathValue(request, "section_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body removeExamSectionRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "exam_sections", sectionID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.RemoveExamSection(request.Context(), decision.Capability, app.RemoveExamSection{
		WriteCommand: app.WriteCommand{IdempotencyKey: key}, ID: sectionID, TenantID: tenantID, ExamVersionID: versionID,
		ExpectedContentVersion: body.ExpectedContentVersion,
	}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

type removeExamItemRequest struct {
	ExpectedContentVersion int64 `json:"expected_content_version"`
}

func (handler *Handler) removeExamItem(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	versionID, err := httpx.ParseUUIDPathValue(request, "exam_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if _, err := httpx.ParseUUIDPathValue(request, "section_id"); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	itemID, err := httpx.ParseUUIDPathValue(request, "item_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body removeExamItemRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "exam_items", itemID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.RemoveExamItem(request.Context(), decision.Capability, app.RemoveExamItem{
		WriteCommand: app.WriteCommand{IdempotencyKey: key}, ID: itemID, TenantID: tenantID, ExamVersionID: versionID,
		ExpectedContentVersion: body.ExpectedContentVersion,
	}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

type publishExamVersionRequest struct {
	ExpectedContentVersion int64 `json:"expected_content_version"`
}

func (handler *Handler) publishExamVersion(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	versionID, err := httpx.ParseUUIDPathValue(request, "exam_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body publishExamVersionRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "exam_versions", versionID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	examVersion, err := handler.service.PublishExamVersion(request.Context(), decision.Capability, app.PublishExamVersion{WriteCommand: app.WriteCommand{IdempotencyKey: key}, TenantID: tenantID, ExamVersionID: versionID, ExpectedContentVersion: body.ExpectedContentVersion})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, examVersion)
}

type createAssignmentRuleRequest struct {
	TargetType     string          `json:"target_type"`
	TargetID       string          `json:"target_id"`
	AvailableFrom  time.Time       `json:"available_from"`
	AvailableUntil time.Time       `json:"available_until"`
	Accommodations json.RawMessage `json:"accommodations"`
}

func (handler *Handler) createAssignmentRule(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	versionID, err := httpx.ParseUUIDPathValue(request, "exam_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body createAssignmentRuleRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "assignment_rules", id, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	rule, err := handler.service.CreateAssignmentRule(request.Context(), decision.Capability, app.CreateAssignmentRule{
		WriteCommand: app.WriteCommand{IdempotencyKey: key}, ID: id, TenantID: tenantID, ExamVersionID: versionID, TargetType: body.TargetType,
		TargetID: body.TargetID, AvailableFrom: body.AvailableFrom, AvailableUntil: body.AvailableUntil,
		Accommodations: body.Accommodations,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, rule)
}

type materializeCandidateAssignmentRequest struct {
	CandidateID string `json:"candidate_id"`
}

func (handler *Handler) materializeDirectCandidateAssignment(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	ruleID, err := httpx.ParseUUIDPathValue(request, "assignment_rule_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body materializeCandidateAssignmentRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "candidate_assignments", id, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	assignment, err := handler.service.MaterializeDirectCandidateAssignment(request.Context(), decision.Capability, app.MaterializeDirectCandidateAssignment{
		WriteCommand: app.WriteCommand{IdempotencyKey: key}, ID: id, TenantID: tenantID, AssignmentRuleID: ruleID, CandidateID: body.CandidateID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, assignment)
}

type revokeCandidateAssignmentRequest struct {
	ExpectedVersion int64 `json:"expected_version"`
}

func (handler *Handler) revokeCandidateAssignment(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	assignmentID, err := httpx.ParseUUIDPathValue(request, "candidate_assignment_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body revokeCandidateAssignmentRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "candidate_assignments", assignmentID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	assignment, err := handler.service.RevokeCandidateAssignment(request.Context(), decision.Capability, app.RevokeCandidateAssignment{
		WriteCommand: app.WriteCommand{IdempotencyKey: key}, TenantID: tenantID,
		CandidateAssignmentID: assignmentID, ExpectedVersion: body.ExpectedVersion,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, assignment)
}

func (handler *Handler) getCandidateAssignment(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	assignmentID, err := httpx.ParseUUIDPathValue(request, "candidate_assignment_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "candidate_assignments", assignmentID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	assignment, err := handler.service.GetCandidateAssignment(request.Context(), decision.Capability, app.GetCandidateAssignment{TenantID: tenantID, CandidateAssignmentID: assignmentID})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, assignment)
}

type updateExamRequest struct {
	ExpectedVersion   int64  `json:"expected_version"`
	ExternalReference string `json:"external_reference"`
}

func (handler *Handler) updateExam(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	examID, err := httpx.ParseUUIDPathValue(request, "exam_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body updateExamRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "exams", examID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	exam, err := handler.service.UpdateExam(request.Context(), decision.Capability, app.UpdateExam{
		ID: examID, TenantID: tenantID, ExpectedVersion: body.ExpectedVersion,
		ExternalReference: body.ExternalReference,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, exam)
}

type deleteExamRequest struct {
	Reason string `json:"reason"`
}

func (handler *Handler) deleteExam(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	examID, err := httpx.ParseUUIDPathValue(request, "exam_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body deleteExamRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "exams", examID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.DeleteExam(request.Context(), decision.Capability, app.DeleteExam{
		ID: examID, TenantID: tenantID, ActorID: decision.Capability.ActorID, Reason: body.Reason,
	}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) hardDeleteExam(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	examID, err := httpx.ParseUUIDPathValue(request, "exam_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body deleteExamRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "exams", examID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.HardDeleteExam(request.Context(), decision.Capability, app.DeleteExam{
		ID: examID, TenantID: tenantID, ActorID: decision.Capability.ActorID,
		Reason: body.Reason,
	}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) getExam(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	examID, err := httpx.ParseUUIDPathValue(request, "exam_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "exams", examID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	exam, err := handler.service.GetExam(request.Context(), decision.Capability, tenantID, examID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, exam)
}

func (handler *Handler) getProctorPolicy(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	policyID, err := httpx.ParseUUIDPathValue(request, "proctor_policy_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "proctor_policies", policyID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	policy, err := handler.service.GetProctorPolicy(request.Context(), decision.Capability, tenantID, policyID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, policy)
}

func (handler *Handler) getProctorPolicyVersion(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	versionID, err := httpx.ParseUUIDPathValue(request, "proctor_policy_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "proctor_policy_versions", versionID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	policyVersion, err := handler.service.GetProctorPolicyVersion(request.Context(), decision.Capability, tenantID, versionID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, policyVersion)
}

func tenantID(request *http.Request) (string, error) {
	return httpx.ParseUUIDPathValue(request, "tenant_id")
}

func idempotencyKey(request *http.Request) (string, error) {
	key := strings.TrimSpace(request.Header.Get("Idempotency-Key"))
	if len(key) == 0 || len(key) > 255 {
		return "", apperrors.New(apperrors.CodeInvalidArgument, "Idempotency-Key is required and must contain 1 to 255 printable characters")
	}
	for _, character := range key {
		if character < '!' || character > '~' {
			return "", apperrors.New(apperrors.CodeInvalidArgument, "Idempotency-Key is required and must contain 1 to 255 printable characters")
		}
	}
	return key, nil
}
