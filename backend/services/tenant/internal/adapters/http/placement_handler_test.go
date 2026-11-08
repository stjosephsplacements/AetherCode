package httpadapter

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestListPlacementOrganizationsRejectsLimitAboveMax(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest("GET", "/v1/placement-organizations?limit=101", nil)
	recorder := httptest.NewRecorder()
	handler := &Handler{}
	handler.listPlacementOrganizations(recorder, request)
	if recorder.Code == 200 {
		t.Fatalf("expected non-200 for limit > 100, got %d", recorder.Code)
	}
}

func TestListPlacementOrganizationsRejectsMalformedCursor(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest("GET", "/v1/placement-organizations?cursor=!!!", nil)
	recorder := httptest.NewRecorder()
	handler := &Handler{}
	handler.listPlacementOrganizations(recorder, request)
	if recorder.Code == 200 {
		t.Fatalf("expected non-200 for malformed cursor, got %d", recorder.Code)
	}
}

func TestListPlacementOrganizationsRejectsInvalidStatus(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest("GET", "/v1/placement-organizations?status=invalid", nil)
	recorder := httptest.NewRecorder()
	handler := &Handler{}
	handler.listPlacementOrganizations(recorder, request)
	if recorder.Code == 200 {
		t.Fatalf("expected non-200 for invalid status, got %d", recorder.Code)
	}
}

func TestUpdatePlacementOrganizationRejectsInvalidOrgID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	recorder := httptest.NewRecorder()
	handler.updatePlacementOrganization(recorder, httptest.NewRequest(http.MethodPatch,
		"/v1/placement-organizations/not-a-uuid", strings.NewReader(`{"legal_name":"X"}`)))
	if recorder.Code == http.StatusOK {
		t.Fatalf("updatePlacementOrganization accepted invalid UUID, got %d", recorder.Code)
	}
}

func TestCreatePlacementOrganizationRejectsUnknownField(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	recorder := httptest.NewRecorder()
	handler.createPlacementOrganization(recorder, httptest.NewRequest(http.MethodPost,
		"/v1/placement-organizations", strings.NewReader(`{"code":"ABC","legal_name":"X","extra":true}`)))
	if recorder.Code == http.StatusOK || recorder.Code == http.StatusCreated {
		t.Fatalf("createPlacementOrganization accepted unknown field, got %d", recorder.Code)
	}
}

func TestGetPlacementOrganizationRejectsInvalidOrgID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	recorder := httptest.NewRecorder()
	handler.getPlacementOrganization(recorder, httptest.NewRequest(http.MethodGet,
		"/v1/placement-organizations/not-a-uuid", nil))
	if recorder.Code == http.StatusOK {
		t.Fatalf("getPlacementOrganization accepted invalid UUID, got %d", recorder.Code)
	}
}

func TestDeletePlacementOrganizationRejectsInvalidOrgID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	recorder := httptest.NewRecorder()
	handler.deletePlacementOrganization(recorder, httptest.NewRequest(http.MethodDelete,
		"/v1/placement-organizations/not-a-uuid", strings.NewReader(`{"reason":"test"}`)))
	if recorder.Code == http.StatusOK || recorder.Code == http.StatusNoContent {
		t.Fatalf("deletePlacementOrganization accepted invalid UUID, got %d", recorder.Code)
	}
}

func TestCreatePlacementDepartmentRejectsInvalidOrgID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	recorder := httptest.NewRecorder()
	handler.createPlacementDepartment(recorder, httptest.NewRequest(http.MethodPost,
		"/v1/placement-organizations/not-a-uuid/departments", strings.NewReader(`{"code":"CS","name":"CS"}`)))
	if recorder.Code == http.StatusOK || recorder.Code == http.StatusCreated {
		t.Fatalf("createPlacementDepartment accepted invalid UUID, got %d", recorder.Code)
	}
}

func TestListPlacementDepartmentsRejectsInvalidOrgID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	recorder := httptest.NewRecorder()
	handler.listPlacementDepartments(recorder, httptest.NewRequest(http.MethodGet,
		"/v1/placement-organizations/not-a-uuid/departments", nil))
	if recorder.Code == http.StatusOK {
		t.Fatalf("listPlacementDepartments accepted invalid UUID, got %d", recorder.Code)
	}
}
