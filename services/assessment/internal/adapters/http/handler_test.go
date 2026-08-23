package httpadapter

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/httpauth"
	"github.com/aethercode/aethercode/services/assessment/internal/app"
)

// -- helpers -----------------------------------------------------------------

const (
	testTenantID  = "018f4b0d-08f8-7c09-9ba7-efdf9c222001"
	testExamID    = "018f4b0d-08f8-7c09-9ba7-efdf9c222002"
	testPolicyID  = "018f4b0d-08f8-7c09-9ba7-efdf9c222003"
	testVersionID = "018f4b0d-08f8-7c09-9ba7-efdf9c222004"
	testSectionID = "018f4b0d-08f8-7c09-9ba7-efdf9c222005"
	testItemID    = "018f4b0d-08f8-7c09-9ba7-efdf9c222006"
)

// stubAuthorizer implements httpAuthorizer and always returns the configured decision.
type stubAuthorizer struct {
	decision httpauth.Decision
	err      error
}

func (s *stubAuthorizer) AuthorizeHTTP(_ context.Context, _ *http.Request, _, _, _, _ string) (httpauth.Decision, error) {
	return s.decision, s.err
}

func (s *stubAuthorizer) AuthorizeSelfHTTP(_ context.Context, _ *http.Request, _, _, _ string) (httpauth.Decision, error) {
	return s.decision, s.err
}

// stubService implements appService. Each method field may be nil; the method
// implementation panics if called without a non-nil field — this makes
// unexpected calls clearly visible in test output.
type stubService struct {
	getExamFn                   func(context.Context, centralauthz.Capability, string, string) (app.Exam, error)
	getProctorPolicyFn          func(context.Context, centralauthz.Capability, string, string) (app.ProctorPolicy, error)
	getProctorPolicyVersionFn   func(context.Context, centralauthz.Capability, string, string) (app.ProctorPolicyVersion, error)
	listProctorPoliciesFn       func(context.Context, centralauthz.Capability, app.ListProctorPolicies) (app.Page[app.ProctorPolicy], error)
	listProctorPolicyVersionsFn func(context.Context, centralauthz.Capability, app.ListProctorPolicyVersions) (app.Page[app.ProctorPolicyVersion], error)
	removeExamSectionFn         func(context.Context, centralauthz.Capability, app.RemoveExamSection) error
	removeExamItemFn            func(context.Context, centralauthz.Capability, app.RemoveExamItem) error
}

func (s *stubService) GetExam(ctx context.Context, cap centralauthz.Capability, tenantID, examID string) (app.Exam, error) {
	return s.getExamFn(ctx, cap, tenantID, examID)
}
func (s *stubService) GetProctorPolicy(ctx context.Context, cap centralauthz.Capability, tenantID, policyID string) (app.ProctorPolicy, error) {
	return s.getProctorPolicyFn(ctx, cap, tenantID, policyID)
}
func (s *stubService) GetProctorPolicyVersion(ctx context.Context, cap centralauthz.Capability, tenantID, versionID string) (app.ProctorPolicyVersion, error) {
	return s.getProctorPolicyVersionFn(ctx, cap, tenantID, versionID)
}
func (s *stubService) ListProctorPolicies(ctx context.Context, cap centralauthz.Capability, cmd app.ListProctorPolicies) (app.Page[app.ProctorPolicy], error) {
	return s.listProctorPoliciesFn(ctx, cap, cmd)
}
func (s *stubService) ListProctorPolicyVersions(ctx context.Context, cap centralauthz.Capability, cmd app.ListProctorPolicyVersions) (app.Page[app.ProctorPolicyVersion], error) {
	return s.listProctorPolicyVersionsFn(ctx, cap, cmd)
}

// Unexercised appService methods — panic so unexpected calls are caught immediately.
func (s *stubService) CreateProctorPolicy(context.Context, centralauthz.Capability, app.CreateProctorPolicy) (app.ProctorPolicy, error) {
	panic("CreateProctorPolicy not expected")
}
func (s *stubService) CreateProctorPolicyVersion(context.Context, centralauthz.Capability, app.CreateProctorPolicyVersion) (app.ProctorPolicyVersion, error) {
	panic("CreateProctorPolicyVersion not expected")
}
func (s *stubService) PublishProctorPolicyVersion(context.Context, centralauthz.Capability, app.PublishProctorPolicyVersion) (app.ProctorPolicyVersion, error) {
	panic("PublishProctorPolicyVersion not expected")
}
func (s *stubService) CreateExam(context.Context, centralauthz.Capability, app.CreateExam) (app.Exam, error) {
	panic("CreateExam not expected")
}
func (s *stubService) UpdateExam(context.Context, centralauthz.Capability, app.UpdateExam) (app.Exam, error) {
	panic("UpdateExam not expected")
}
func (s *stubService) DeleteExam(context.Context, centralauthz.Capability, app.DeleteExam) error {
	panic("DeleteExam not expected")
}
func (s *stubService) HardDeleteExam(context.Context, centralauthz.Capability, app.DeleteExam) error {
	panic("HardDeleteExam not expected")
}
func (s *stubService) CreateExamVersion(context.Context, centralauthz.Capability, app.CreateExamVersion) (app.ExamVersion, error) {
	panic("CreateExamVersion not expected")
}
func (s *stubService) GetExamVersion(context.Context, centralauthz.Capability, app.GetExamVersion) (app.ExamVersion, error) {
	panic("GetExamVersion not expected")
}
func (s *stubService) AddExamSection(context.Context, centralauthz.Capability, app.AddExamSection) (app.ExamSection, error) {
	panic("AddExamSection not expected")
}
func (s *stubService) AddExamItem(context.Context, centralauthz.Capability, app.AddExamItem) (app.ExamItem, error) {
	panic("AddExamItem not expected")
}
func (s *stubService) RemoveExamSection(ctx context.Context, cap centralauthz.Capability, cmd app.RemoveExamSection) error {
	return s.removeExamSectionFn(ctx, cap, cmd)
}
func (s *stubService) RemoveExamItem(ctx context.Context, cap centralauthz.Capability, cmd app.RemoveExamItem) error {
	return s.removeExamItemFn(ctx, cap, cmd)
}
func (s *stubService) PublishExamVersion(context.Context, centralauthz.Capability, app.PublishExamVersion) (app.ExamVersion, error) {
	panic("PublishExamVersion not expected")
}
func (s *stubService) CreateAssignmentRule(context.Context, centralauthz.Capability, app.CreateAssignmentRule) (app.AssignmentRule, error) {
	panic("CreateAssignmentRule not expected")
}
func (s *stubService) MaterializeDirectCandidateAssignment(context.Context, centralauthz.Capability, app.MaterializeDirectCandidateAssignment) (app.CandidateAssignment, error) {
	panic("MaterializeDirectCandidateAssignment not expected")
}
func (s *stubService) RevokeCandidateAssignment(context.Context, centralauthz.Capability, app.RevokeCandidateAssignment) (app.CandidateAssignment, error) {
	panic("RevokeCandidateAssignment not expected")
}
func (s *stubService) GetCandidateAssignment(context.Context, centralauthz.Capability, app.GetCandidateAssignment) (app.CandidateAssignment, error) {
	panic("GetCandidateAssignment not expected")
}
func (s *stubService) ListCandidateAssignments(context.Context, centralauthz.Capability, app.ListCandidateAssignments) (app.Page[app.CandidateAssignment], error) {
	panic("ListCandidateAssignments not expected")
}
func (s *stubService) ListExams(context.Context, centralauthz.Capability, app.ListExams) (app.Page[app.Exam], error) {
	panic("ListExams not expected")
}
func (s *stubService) ListExamVersions(context.Context, centralauthz.Capability, app.ListExamVersions) (app.Page[app.ExamVersion], error) {
	panic("ListExamVersions not expected")
}

// allowedAuthorizer returns a stub that grants every request.
func allowedAuthorizer() *stubAuthorizer {
	return &stubAuthorizer{decision: httpauth.Decision{}}
}

// -- idempotency key ---------------------------------------------------------

func TestIdempotencyKeyRequiresPrintableHeader(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name    string
		key     string
		wantErr bool
	}{
		{name: "valid", key: "assessment:01JTEST"},
		{name: "missing", wantErr: true},
		{name: "space", key: "has space", wantErr: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/", nil)
			if testCase.key != "" {
				request.Header.Set("Idempotency-Key", testCase.key)
			}
			_, err := idempotencyKey(request)
			if (err != nil) != testCase.wantErr {
				t.Fatalf("idempotencyKey() error = %v, wantErr = %t", err, testCase.wantErr)
			}
		})
	}
}

// -- GET /v1/tenants/{tenant_id}/exams/{exam_id} -----------------------------

func TestGetExamRejectsInvalidExamID(t *testing.T) {
	t.Parallel()
	handler := &Handler{authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/"+testTenantID+"/exams/not-a-uuid", nil)
	request.SetPathValue("tenant_id", testTenantID)
	request.SetPathValue("exam_id", "not-a-uuid")

	handler.getExam(writer, request)

	if writer.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", writer.Code)
	}
}

func TestGetExamReturns200OnSuccess(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	svc := &stubService{
		getExamFn: func(_ context.Context, _ centralauthz.Capability, _, _ string) (app.Exam, error) {
			return app.Exam{
				ID: testExamID, TenantID: testTenantID,
				LifecycleState: "draft", Version: 1,
				CreatedAt: now, UpdatedAt: now,
			}, nil
		},
	}
	handler := &Handler{service: svc, authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/"+testTenantID+"/exams/"+testExamID, nil)
	request.SetPathValue("tenant_id", testTenantID)
	request.SetPathValue("exam_id", testExamID)

	handler.getExam(writer, request)

	if writer.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", writer.Code)
	}
	var got app.Exam
	if err := json.NewDecoder(writer.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.ID != testExamID {
		t.Fatalf("exam.ID = %q, want %q", got.ID, testExamID)
	}
}

func TestGetExamReturns404WhenNotFound(t *testing.T) {
	t.Parallel()
	svc := &stubService{
		getExamFn: func(_ context.Context, _ centralauthz.Capability, _, _ string) (app.Exam, error) {
			return app.Exam{}, apperrors.New(apperrors.CodeNotFound, "exam was not found")
		},
	}
	handler := &Handler{service: svc, authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/"+testTenantID+"/exams/"+testExamID, nil)
	request.SetPathValue("tenant_id", testTenantID)
	request.SetPathValue("exam_id", testExamID)

	handler.getExam(writer, request)

	if writer.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", writer.Code)
	}
}

// -- GET /v1/tenants/{tenant_id}/proctor-policies/{proctor_policy_id} --------

func TestGetProctorPolicyRejectsInvalidPolicyID(t *testing.T) {
	t.Parallel()
	handler := &Handler{authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/"+testTenantID+"/proctor-policies/not-a-uuid", nil)
	request.SetPathValue("tenant_id", testTenantID)
	request.SetPathValue("proctor_policy_id", "not-a-uuid")

	handler.getProctorPolicy(writer, request)

	if writer.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", writer.Code)
	}
}

func TestGetProctorPolicyReturns200OnSuccess(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	svc := &stubService{
		getProctorPolicyFn: func(_ context.Context, _ centralauthz.Capability, _, _ string) (app.ProctorPolicy, error) {
			return app.ProctorPolicy{
				ID: testPolicyID, TenantID: testTenantID,
				Name: "test policy", LifecycleState: "draft",
				Version: 1, CreatedAt: now,
			}, nil
		},
	}
	handler := &Handler{service: svc, authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/"+testTenantID+"/proctor-policies/"+testPolicyID, nil)
	request.SetPathValue("tenant_id", testTenantID)
	request.SetPathValue("proctor_policy_id", testPolicyID)

	handler.getProctorPolicy(writer, request)

	if writer.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", writer.Code)
	}
	var got app.ProctorPolicy
	if err := json.NewDecoder(writer.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.ID != testPolicyID {
		t.Fatalf("policy.ID = %q, want %q", got.ID, testPolicyID)
	}
}

func TestGetProctorPolicyReturns404WhenNotFound(t *testing.T) {
	t.Parallel()
	svc := &stubService{
		getProctorPolicyFn: func(_ context.Context, _ centralauthz.Capability, _, _ string) (app.ProctorPolicy, error) {
			return app.ProctorPolicy{}, apperrors.New(apperrors.CodeNotFound, "proctor policy was not found")
		},
	}
	handler := &Handler{service: svc, authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/"+testTenantID+"/proctor-policies/"+testPolicyID, nil)
	request.SetPathValue("tenant_id", testTenantID)
	request.SetPathValue("proctor_policy_id", testPolicyID)

	handler.getProctorPolicy(writer, request)

	if writer.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", writer.Code)
	}
}

// -- GET /v1/tenants/{tenant_id}/proctor-policy-versions/{id} ----------------

func TestGetProctorPolicyVersionRejectsInvalidVersionID(t *testing.T) {
	t.Parallel()
	handler := &Handler{authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/"+testTenantID+"/proctor-policy-versions/not-a-uuid", nil)
	request.SetPathValue("tenant_id", testTenantID)
	request.SetPathValue("proctor_policy_version_id", "not-a-uuid")

	handler.getProctorPolicyVersion(writer, request)

	if writer.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", writer.Code)
	}
}

func TestGetProctorPolicyVersionReturns200OnSuccess(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	svc := &stubService{
		getProctorPolicyVersionFn: func(_ context.Context, _ centralauthz.Capability, _, _ string) (app.ProctorPolicyVersion, error) {
			return app.ProctorPolicyVersion{
				ID: testVersionID, TenantID: testTenantID,
				ProctorPolicyID: testPolicyID, VersionNumber: 1,
				Policy:         json.RawMessage(`{}`),
				PolicyChecksum: "abc123",
				Status:         "draft", CreatedAt: now,
			}, nil
		},
	}
	handler := &Handler{service: svc, authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/"+testTenantID+"/proctor-policy-versions/"+testVersionID, nil)
	request.SetPathValue("tenant_id", testTenantID)
	request.SetPathValue("proctor_policy_version_id", testVersionID)

	handler.getProctorPolicyVersion(writer, request)

	if writer.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", writer.Code)
	}
	var got app.ProctorPolicyVersion
	if err := json.NewDecoder(writer.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.ID != testVersionID {
		t.Fatalf("version.ID = %q, want %q", got.ID, testVersionID)
	}
}

func TestGetProctorPolicyVersionReturns404WhenNotFound(t *testing.T) {
	t.Parallel()
	svc := &stubService{
		getProctorPolicyVersionFn: func(_ context.Context, _ centralauthz.Capability, _, _ string) (app.ProctorPolicyVersion, error) {
			return app.ProctorPolicyVersion{}, apperrors.New(apperrors.CodeNotFound, "proctor policy version was not found")
		},
	}
	handler := &Handler{service: svc, authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/"+testTenantID+"/proctor-policy-versions/"+testVersionID, nil)
	request.SetPathValue("tenant_id", testTenantID)
	request.SetPathValue("proctor_policy_version_id", testVersionID)

	handler.getProctorPolicyVersion(writer, request)

	if writer.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", writer.Code)
	}
}

// -- GET /v1/tenants/{tenant_id}/proctor-policies (list) --------------------

func TestListProctorPoliciesReturns200WithEmptyPage(t *testing.T) {
	t.Parallel()
	svc := &stubService{
		listProctorPoliciesFn: func(_ context.Context, _ centralauthz.Capability, _ app.ListProctorPolicies) (app.Page[app.ProctorPolicy], error) {
			return app.Page[app.ProctorPolicy]{Items: []app.ProctorPolicy{}}, nil
		},
	}
	handler := &Handler{service: svc, authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/"+testTenantID+"/proctor-policies", nil)
	request.SetPathValue("tenant_id", testTenantID)

	handler.listProctorPolicies(writer, request)

	if writer.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", writer.Code)
	}
}

func TestListProctorPoliciesRejectsInvalidLimit(t *testing.T) {
	t.Parallel()
	handler := &Handler{authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/"+testTenantID+"/proctor-policies?limit=999", nil)
	request.SetPathValue("tenant_id", testTenantID)

	handler.listProctorPolicies(writer, request)

	if writer.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", writer.Code)
	}
}

// -- GET /v1/tenants/{tenant_id}/proctor-policies/{id}/versions (list) -------

func TestListProctorPolicyVersionsReturns200WithEmptyPage(t *testing.T) {
	t.Parallel()
	svc := &stubService{
		listProctorPolicyVersionsFn: func(_ context.Context, _ centralauthz.Capability, _ app.ListProctorPolicyVersions) (app.Page[app.ProctorPolicyVersion], error) {
			return app.Page[app.ProctorPolicyVersion]{Items: []app.ProctorPolicyVersion{}}, nil
		},
	}
	handler := &Handler{service: svc, authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/"+testTenantID+"/proctor-policies/"+testPolicyID+"/versions", nil)
	request.SetPathValue("tenant_id", testTenantID)
	request.SetPathValue("proctor_policy_id", testPolicyID)

	handler.listProctorPolicyVersions(writer, request)

	if writer.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", writer.Code)
	}
}

func TestListProctorPolicyVersionsRejectsInvalidPolicyID(t *testing.T) {
	t.Parallel()
	handler := &Handler{authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/"+testTenantID+"/proctor-policies/not-a-uuid/versions", nil)
	request.SetPathValue("tenant_id", testTenantID)
	request.SetPathValue("proctor_policy_id", "not-a-uuid")

	handler.listProctorPolicyVersions(writer, request)

	if writer.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", writer.Code)
	}
}

// -- DELETE /v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/sections/{section_id} ----

func removeExamSectionRequestBody(t *testing.T, contentVersion int64) *http.Request {
	t.Helper()
	body := strings.NewReader(`{"expected_content_version":` + strconv.FormatInt(contentVersion, 10) + `}`)
	request := httptest.NewRequest(http.MethodDelete,
		"/v1/tenants/"+testTenantID+"/exam-versions/"+testVersionID+"/sections/"+testSectionID, body)
	request.Header.Set("Idempotency-Key", "assessment:remove-section")
	request.SetPathValue("tenant_id", testTenantID)
	request.SetPathValue("exam_version_id", testVersionID)
	request.SetPathValue("section_id", testSectionID)
	return request
}

func TestRemoveExamSectionReturns204OnSuccess(t *testing.T) {
	t.Parallel()
	svc := &stubService{
		removeExamSectionFn: func(_ context.Context, _ centralauthz.Capability, _ app.RemoveExamSection) error {
			return nil
		},
	}
	handler := &Handler{service: svc, authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()

	handler.removeExamSection(writer, removeExamSectionRequestBody(t, 1))

	if writer.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", writer.Code)
	}
}

func TestRemoveExamSectionReturnsConflictOnStaleContentVersion(t *testing.T) {
	t.Parallel()
	svc := &stubService{
		removeExamSectionFn: func(_ context.Context, _ centralauthz.Capability, _ app.RemoveExamSection) error {
			return apperrors.New(apperrors.CodeConflict, "exam content version is stale")
		},
	}
	handler := &Handler{service: svc, authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()

	handler.removeExamSection(writer, removeExamSectionRequestBody(t, 1))

	if writer.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", writer.Code)
	}
}

func TestRemoveExamSectionReturnsConflictWhenVersionPublished(t *testing.T) {
	t.Parallel()
	svc := &stubService{
		removeExamSectionFn: func(_ context.Context, _ centralauthz.Capability, _ app.RemoveExamSection) error {
			return apperrors.New(apperrors.CodeConflict, "published exam version is immutable")
		},
	}
	handler := &Handler{service: svc, authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()

	handler.removeExamSection(writer, removeExamSectionRequestBody(t, 1))

	if writer.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", writer.Code)
	}
}

func TestRemoveExamSectionReturnsNotFoundWhenMissing(t *testing.T) {
	t.Parallel()
	svc := &stubService{
		removeExamSectionFn: func(_ context.Context, _ centralauthz.Capability, _ app.RemoveExamSection) error {
			return apperrors.New(apperrors.CodeNotFound, "exam section was not found")
		},
	}
	handler := &Handler{service: svc, authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()

	handler.removeExamSection(writer, removeExamSectionRequestBody(t, 1))

	if writer.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", writer.Code)
	}
}

func TestRemoveExamSectionRejectsSectionWithItems(t *testing.T) {
	t.Parallel()
	svc := &stubService{
		removeExamSectionFn: func(_ context.Context, _ centralauthz.Capability, _ app.RemoveExamSection) error {
			return apperrors.New(apperrors.CodeInvalidArgument, "exam section still has items; remove them first")
		},
	}
	handler := &Handler{service: svc, authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()

	handler.removeExamSection(writer, removeExamSectionRequestBody(t, 1))

	if writer.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", writer.Code)
	}
}

func TestRemoveExamSectionRejectsInvalidSectionID(t *testing.T) {
	t.Parallel()
	handler := &Handler{authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodDelete,
		"/v1/tenants/"+testTenantID+"/exam-versions/"+testVersionID+"/sections/not-a-uuid", nil)
	request.SetPathValue("tenant_id", testTenantID)
	request.SetPathValue("exam_version_id", testVersionID)
	request.SetPathValue("section_id", "not-a-uuid")

	handler.removeExamSection(writer, request)

	if writer.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", writer.Code)
	}
}

// -- DELETE .../sections/{section_id}/items/{item_id} ------------------------

func removeExamItemRequestBody(t *testing.T, contentVersion int64) *http.Request {
	t.Helper()
	body := strings.NewReader(`{"expected_content_version":` + strconv.FormatInt(contentVersion, 10) + `}`)
	request := httptest.NewRequest(http.MethodDelete,
		"/v1/tenants/"+testTenantID+"/exam-versions/"+testVersionID+"/sections/"+testSectionID+"/items/"+testItemID, body)
	request.Header.Set("Idempotency-Key", "assessment:remove-item")
	request.SetPathValue("tenant_id", testTenantID)
	request.SetPathValue("exam_version_id", testVersionID)
	request.SetPathValue("section_id", testSectionID)
	request.SetPathValue("item_id", testItemID)
	return request
}

func TestRemoveExamItemReturns204OnSuccess(t *testing.T) {
	t.Parallel()
	svc := &stubService{
		removeExamItemFn: func(_ context.Context, _ centralauthz.Capability, _ app.RemoveExamItem) error {
			return nil
		},
	}
	handler := &Handler{service: svc, authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()

	handler.removeExamItem(writer, removeExamItemRequestBody(t, 1))

	if writer.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", writer.Code)
	}
}

func TestRemoveExamItemReturnsConflictOnStaleContentVersion(t *testing.T) {
	t.Parallel()
	svc := &stubService{
		removeExamItemFn: func(_ context.Context, _ centralauthz.Capability, _ app.RemoveExamItem) error {
			return apperrors.New(apperrors.CodeConflict, "exam content version is stale")
		},
	}
	handler := &Handler{service: svc, authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()

	handler.removeExamItem(writer, removeExamItemRequestBody(t, 1))

	if writer.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", writer.Code)
	}
}

func TestRemoveExamItemReturnsConflictWhenVersionPublished(t *testing.T) {
	t.Parallel()
	svc := &stubService{
		removeExamItemFn: func(_ context.Context, _ centralauthz.Capability, _ app.RemoveExamItem) error {
			return apperrors.New(apperrors.CodeConflict, "published exam version is immutable")
		},
	}
	handler := &Handler{service: svc, authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()

	handler.removeExamItem(writer, removeExamItemRequestBody(t, 1))

	if writer.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", writer.Code)
	}
}

func TestRemoveExamItemReturnsNotFoundWhenMissing(t *testing.T) {
	t.Parallel()
	svc := &stubService{
		removeExamItemFn: func(_ context.Context, _ centralauthz.Capability, _ app.RemoveExamItem) error {
			return apperrors.New(apperrors.CodeNotFound, "exam item was not found")
		},
	}
	handler := &Handler{service: svc, authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()

	handler.removeExamItem(writer, removeExamItemRequestBody(t, 1))

	if writer.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", writer.Code)
	}
}

func TestRemoveExamItemRejectsInvalidItemID(t *testing.T) {
	t.Parallel()
	handler := &Handler{authorizer: allowedAuthorizer()}
	writer := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodDelete,
		"/v1/tenants/"+testTenantID+"/exam-versions/"+testVersionID+"/sections/"+testSectionID+"/items/not-a-uuid", nil)
	request.SetPathValue("tenant_id", testTenantID)
	request.SetPathValue("exam_version_id", testVersionID)
	request.SetPathValue("section_id", testSectionID)
	request.SetPathValue("item_id", "not-a-uuid")

	handler.removeExamItem(writer, request)

	if writer.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", writer.Code)
	}
}
