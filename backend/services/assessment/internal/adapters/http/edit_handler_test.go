package httpadapter

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUpdateExamVersionRejectsInvalidTenantID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPatch,
		"/v1/tenants/not-a-uuid/exam-versions/018f4b0d-08f8-7c09-9ba7-efdf9c222001",
		strings.NewReader(`{"expected_content_version":1}`))
	request.SetPathValue("exam_version_id", "018f4b0d-08f8-7c09-9ba7-efdf9c222001")
	recorder := httptest.NewRecorder()
	handler.updateExamVersion(recorder, request)
	if recorder.Code == http.StatusNoContent {
		t.Fatalf("updateExamVersion accepted invalid tenant UUID, got %d", recorder.Code)
	}
}

func TestUpdateExamVersionRejectsInvalidVersionID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPatch,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c222001/exam-versions/not-a-uuid",
		strings.NewReader(`{"expected_content_version":1}`))
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c222001")
	request.SetPathValue("exam_version_id", "not-a-uuid")
	recorder := httptest.NewRecorder()
	handler.updateExamVersion(recorder, request)
	if recorder.Code == http.StatusNoContent {
		t.Fatalf("updateExamVersion accepted invalid version UUID, got %d", recorder.Code)
	}
}

func TestUpdateExamVersionRejectsUnknownField(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPatch,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c222001/exam-versions/018f4b0d-08f8-7c09-9ba7-efdf9c222002",
		strings.NewReader(`{"expected_content_version":1,"rogue_field":"bad"}`))
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c222001")
	request.SetPathValue("exam_version_id", "018f4b0d-08f8-7c09-9ba7-efdf9c222002")
	recorder := httptest.NewRecorder()
	handler.updateExamVersion(recorder, request)
	if recorder.Code == http.StatusNoContent {
		t.Fatalf("updateExamVersion accepted unknown field, got %d", recorder.Code)
	}
}

func TestUpdateExamSectionRejectsInvalidIDs(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name      string
		tenantID  string
		versionID string
		sectionID string
	}{
		{name: "invalid tenant", tenantID: "not-a-uuid", versionID: "018f4b0d-08f8-7c09-9ba7-efdf9c222002", sectionID: "018f4b0d-08f8-7c09-9ba7-efdf9c222003"},
		{name: "invalid version", tenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c222001", versionID: "not-a-uuid", sectionID: "018f4b0d-08f8-7c09-9ba7-efdf9c222003"},
		{name: "invalid section", tenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c222001", versionID: "018f4b0d-08f8-7c09-9ba7-efdf9c222002", sectionID: "not-a-uuid"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			handler := &Handler{}
			request := httptest.NewRequest(http.MethodPatch, "/v1/tenants/"+testCase.tenantID+"/exam-versions/"+testCase.versionID+"/sections/"+testCase.sectionID,
				strings.NewReader(`{"expected_content_version":1}`))
			request.SetPathValue("tenant_id", testCase.tenantID)
			request.SetPathValue("exam_version_id", testCase.versionID)
			request.SetPathValue("section_id", testCase.sectionID)
			recorder := httptest.NewRecorder()
			handler.updateExamSection(recorder, request)
			if recorder.Code == http.StatusNoContent {
				t.Fatalf("updateExamSection accepted invalid IDs, got %d", recorder.Code)
			}
		})
	}
}

func TestUpdateExamItemRejectsInvalidIDs(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name      string
		tenantID  string
		versionID string
		itemID    string
	}{
		{name: "invalid tenant", tenantID: "not-a-uuid", versionID: "018f4b0d-08f8-7c09-9ba7-efdf9c222002", itemID: "018f4b0d-08f8-7c09-9ba7-efdf9c222004"},
		{name: "invalid version", tenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c222001", versionID: "not-a-uuid", itemID: "018f4b0d-08f8-7c09-9ba7-efdf9c222004"},
		{name: "invalid item", tenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c222001", versionID: "018f4b0d-08f8-7c09-9ba7-efdf9c222002", itemID: "not-a-uuid"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			handler := &Handler{}
			request := httptest.NewRequest(http.MethodPatch, "/v1/tenants/"+testCase.tenantID+"/exam-versions/"+testCase.versionID+"/items/"+testCase.itemID,
				strings.NewReader(`{"expected_content_version":1,"maximum_score":"10"}`))
			request.SetPathValue("tenant_id", testCase.tenantID)
			request.SetPathValue("exam_version_id", testCase.versionID)
			request.SetPathValue("item_id", testCase.itemID)
			recorder := httptest.NewRecorder()
			handler.updateExamItem(recorder, request)
			if recorder.Code == http.StatusNoContent {
				t.Fatalf("updateExamItem accepted invalid IDs, got %d", recorder.Code)
			}
		})
	}
}
