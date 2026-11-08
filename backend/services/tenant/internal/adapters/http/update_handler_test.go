package httpadapter

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUpdateTenantRejectsInvalidTenantID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	recorder := httptest.NewRecorder()
	handler.updateTenant(recorder, httptest.NewRequest(http.MethodPatch,
		"/v1/tenants/not-a-uuid", strings.NewReader(`{"display_name":"X"}`)))
	if recorder.Code == http.StatusOK {
		t.Fatalf("updateTenant accepted invalid tenant UUID, got %d", recorder.Code)
	}
}

func TestUpdateTenantRejectsUnknownField(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPatch,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c225001",
		strings.NewReader(`{"display_name":"X","unknown_field":"bad"}`))
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c225001")
	recorder := httptest.NewRecorder()
	handler.updateTenant(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("updateTenant accepted unknown field, got %d", recorder.Code)
	}
}

func TestUpdateTenantRejectsNonJSONBody(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPatch,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c225001",
		strings.NewReader(`nope`))
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c225001")
	recorder := httptest.NewRecorder()
	handler.updateTenant(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("updateTenant accepted non-JSON body, got %d", recorder.Code)
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

func TestUpdateDepartmentRejectsInvalidTenantOrDepartmentID(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name      string
		tenantID  string
		deptID    string
		wantNonOK bool
	}{
		{name: "invalid tenant", tenantID: "not-a-uuid", deptID: "018f4b0d-08f8-7c09-9ba7-efdf9c225001", wantNonOK: true},
		{name: "invalid dept", tenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c225001", deptID: "not-a-uuid", wantNonOK: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			handler := &Handler{}
			request := httptest.NewRequest(http.MethodPatch, "/v1/tenants/"+testCase.tenantID+"/departments/"+testCase.deptID,
				strings.NewReader(`{"name":"X"}`))
			request.SetPathValue("tenant_id", testCase.tenantID)
			request.SetPathValue("department_id", testCase.deptID)
			recorder := httptest.NewRecorder()
			handler.updateDepartment(recorder, request)
			if recorder.Code == http.StatusOK {
				t.Fatalf("updateDepartment accepted invalid IDs, got %d", recorder.Code)
			}
		})
	}
}

func TestUpdateBatchRejectsInvalidTenantOrBatchID(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name     string
		tenantID string
		batchID  string
	}{
		{name: "invalid tenant", tenantID: "not-a-uuid", batchID: "018f4b0d-08f8-7c09-9ba7-efdf9c225001"},
		{name: "invalid batch", tenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c225001", batchID: "not-a-uuid"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			handler := &Handler{}
			request := httptest.NewRequest(http.MethodPatch, "/v1/tenants/"+testCase.tenantID+"/batches/"+testCase.batchID,
				strings.NewReader(`{"name":"X"}`))
			request.SetPathValue("tenant_id", testCase.tenantID)
			request.SetPathValue("batch_id", testCase.batchID)
			recorder := httptest.NewRecorder()
			handler.updateBatch(recorder, request)
			if recorder.Code == http.StatusOK {
				t.Fatalf("updateBatch accepted invalid IDs, got %d", recorder.Code)
			}
		})
	}
}
