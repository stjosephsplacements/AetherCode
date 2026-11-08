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
