package httpadapter

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ── accounts.go ──────────────────────────────────────────────────────────────

func TestImportStudentsRejectsInvalidTenantID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPost, "/v1/tenants/not-a-uuid/students",
		strings.NewReader(`{"batch_id":"018f4b0d-08f8-7c09-9ba7-efdf9c226001","students":[]}`))
	recorder := httptest.NewRecorder()
	handler.importStudents(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("importStudents accepted invalid tenant UUID, got %d", recorder.Code)
	}
}

func TestImportStudentsRejectsNonJSONBody(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPost, "/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c226001/students",
		strings.NewReader(`nope`))
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c226001")
	recorder := httptest.NewRecorder()
	handler.importStudents(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("importStudents accepted non-JSON body, got %d", recorder.Code)
	}
}

func TestReissueBatchPasswordsRejectsInvalidTenantID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPost, "/v1/tenants/not-a-uuid/batches/018f4b0d-08f8-7c09-9ba7-efdf9c226002/reissue", nil)
	recorder := httptest.NewRecorder()
	handler.reissueBatchPasswords(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("reissueBatchPasswords accepted invalid tenant UUID, got %d", recorder.Code)
	}
}

// ── permissions_handler.go ───────────────────────────────────────────────────

func TestListPermissionsRejectsInvalidTenantID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodGet, "/v1/tenants/not-a-uuid/principals/018f4b0d-08f8-7c09-9ba7-efdf9c226003/permissions", nil)
	request.SetPathValue("principal_id", "018f4b0d-08f8-7c09-9ba7-efdf9c226003")
	recorder := httptest.NewRecorder()
	handler.listPermissions(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("listPermissions accepted invalid tenant UUID, got %d", recorder.Code)
	}
}

func TestListPermissionsRejectsInvalidPrincipalID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodGet, "/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c226001/principals/not-a-uuid/permissions", nil)
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c226001")
	request.SetPathValue("principal_id", "not-a-uuid")
	recorder := httptest.NewRecorder()
	handler.listPermissions(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("listPermissions accepted invalid principal UUID, got %d", recorder.Code)
	}
}

// ── public_profile_handler.go ────────────────────────────────────────────────

func TestGetOwnPublicProfileRejectsInvalidPrincipalID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodGet, "/v1/principals/not-a-uuid/profile?tenant_id=018f4b0d-08f8-7c09-9ba7-efdf9c226001", nil)
	recorder := httptest.NewRecorder()
	handler.getOwnPublicProfile(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("getOwnPublicProfile accepted invalid principal UUID, got %d", recorder.Code)
	}
}

func TestGetOwnPublicProfileRejectsInvalidTenantQuery(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodGet, "/v1/principals/018f4b0d-08f8-7c09-9ba7-efdf9c226003/profile?tenant_id=not-a-uuid", nil)
	request.SetPathValue("principal_id", "018f4b0d-08f8-7c09-9ba7-efdf9c226003")
	recorder := httptest.NewRecorder()
	handler.getOwnPublicProfile(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("getOwnPublicProfile accepted invalid tenant_id query param, got %d", recorder.Code)
	}
}

func TestSetOwnPublicProfileRejectsNonJSONBody(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPut,
		"/v1/principals/018f4b0d-08f8-7c09-9ba7-efdf9c226003/profile?tenant_id=018f4b0d-08f8-7c09-9ba7-efdf9c226001",
		strings.NewReader(`nope`))
	request.SetPathValue("principal_id", "018f4b0d-08f8-7c09-9ba7-efdf9c226003")
	recorder := httptest.NewRecorder()
	handler.setOwnPublicProfile(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("setOwnPublicProfile accepted non-JSON body, got %d", recorder.Code)
	}
}

// ── roles_handler.go ─────────────────────────────────────────────────────────

func TestListRolesRejectsInvalidTenantID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodGet, "/v1/tenants/not-a-uuid/roles", nil)
	recorder := httptest.NewRecorder()
	handler.listRoles(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("listRoles accepted invalid tenant UUID, got %d", recorder.Code)
	}
}

func TestCreateRoleRejectsNonJSONBody(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPost, "/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c226001/roles",
		strings.NewReader(`nope`))
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c226001")
	recorder := httptest.NewRecorder()
	handler.createRole(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("createRole accepted non-JSON body, got %d", recorder.Code)
	}
}

func TestUpdateRoleRejectsInvalidRoleID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPatch,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c226001/roles/not-a-uuid",
		strings.NewReader(`{"name":"x"}`))
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c226001")
	request.SetPathValue("role_id", "not-a-uuid")
	recorder := httptest.NewRecorder()
	handler.updateRole(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("updateRole accepted invalid role UUID, got %d", recorder.Code)
	}
}

// ── student_update_handler.go ────────────────────────────────────────────────

func TestUpdateStudentRejectsInvalidTenantID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPatch,
		"/v1/tenants/not-a-uuid/students/018f4b0d-08f8-7c09-9ba7-efdf9c226003",
		strings.NewReader(`{}`))
	recorder := httptest.NewRecorder()
	handler.updateStudent(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("updateStudent accepted invalid tenant UUID, got %d", recorder.Code)
	}
}

func TestUpdateStudentRejectsInvalidStudentID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPatch,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c226001/students/not-a-uuid",
		strings.NewReader(`{}`))
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c226001")
	request.SetPathValue("student_id", "not-a-uuid")
	recorder := httptest.NewRecorder()
	handler.updateStudent(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("updateStudent accepted invalid student UUID, got %d", recorder.Code)
	}
}

func TestUpdateStudentRejectsNonJSONBody(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPatch,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c226001/students/018f4b0d-08f8-7c09-9ba7-efdf9c226003",
		strings.NewReader(`nope`))
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c226001")
	request.SetPathValue("student_id", "018f4b0d-08f8-7c09-9ba7-efdf9c226003")
	recorder := httptest.NewRecorder()
	handler.updateStudent(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("updateStudent accepted non-JSON body, got %d", recorder.Code)
	}
}
