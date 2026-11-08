package httpadapter

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPutExamPolicyRejectsInvalidTenantID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPut,
		"/v1/tenants/not-a-uuid/exams/018f4b0d-08f8-7c09-9ba7-efdf9c223001/policy",
		strings.NewReader(`{"title":"T","enabled":true,"accepted_keys":[],"allowed_networks":[]}`))
	request.SetPathValue("tenant_id", "not-a-uuid")
	request.SetPathValue("exam_id", "018f4b0d-08f8-7c09-9ba7-efdf9c223001")
	recorder := httptest.NewRecorder()
	handler.putExamPolicy(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("putExamPolicy accepted invalid tenant UUID, got %d", recorder.Code)
	}
}

func TestPutExamPolicyRejectsInvalidExamID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPut,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c223001/exams/not-a-uuid/policy",
		strings.NewReader(`{"title":"T","enabled":true,"accepted_keys":[],"allowed_networks":[]}`))
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c223001")
	request.SetPathValue("exam_id", "not-a-uuid")
	recorder := httptest.NewRecorder()
	handler.putExamPolicy(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("putExamPolicy accepted invalid exam UUID, got %d", recorder.Code)
	}
}

func TestPutExamPolicyRejectsNonJSONBody(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPut,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c223001/exams/018f4b0d-08f8-7c09-9ba7-efdf9c223002/policy",
		strings.NewReader(`not json`))
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c223001")
	request.SetPathValue("exam_id", "018f4b0d-08f8-7c09-9ba7-efdf9c223002")
	recorder := httptest.NewRecorder()
	handler.putExamPolicy(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("putExamPolicy accepted non-JSON body, got %d", recorder.Code)
	}
}

func TestGetExamPolicyRejectsInvalidIDs(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name     string
		tenantID string
		examID   string
	}{
		{name: "invalid tenant", tenantID: "not-a-uuid", examID: "018f4b0d-08f8-7c09-9ba7-efdf9c223002"},
		{name: "invalid exam", tenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c223001", examID: "not-a-uuid"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			handler := &Handler{}
			request := httptest.NewRequest(http.MethodGet, "/v1/tenants/"+testCase.tenantID+"/exams/"+testCase.examID+"/policy", nil)
			request.SetPathValue("tenant_id", testCase.tenantID)
			request.SetPathValue("exam_id", testCase.examID)
			recorder := httptest.NewRecorder()
			handler.getExamPolicy(recorder, request)
			if recorder.Code == http.StatusOK {
				t.Fatalf("getExamPolicy accepted invalid IDs, got %d", recorder.Code)
			}
		})
	}
}

func TestGetStaffLaunchFileRejectsInvalidIDs(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name     string
		tenantID string
		examID   string
	}{
		{name: "invalid tenant", tenantID: "not-a-uuid", examID: "018f4b0d-08f8-7c09-9ba7-efdf9c223002"},
		{name: "invalid exam", tenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c223001", examID: "not-a-uuid"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			handler := &Handler{}
			request := httptest.NewRequest(http.MethodGet, "/v1/tenants/"+testCase.tenantID+"/exams/"+testCase.examID+"/launch-file", nil)
			request.SetPathValue("tenant_id", testCase.tenantID)
			request.SetPathValue("exam_id", testCase.examID)
			recorder := httptest.NewRecorder()
			handler.getStaffLaunchFile(recorder, request)
			if recorder.Code == http.StatusOK {
				t.Fatalf("getStaffLaunchFile accepted invalid IDs, got %d", recorder.Code)
			}
		})
	}
}

func TestGetCandidateLaunchFileRejectsInvalidIDs(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name     string
		tenantID string
		examID   string
	}{
		{name: "invalid tenant", tenantID: "not-a-uuid", examID: "018f4b0d-08f8-7c09-9ba7-efdf9c223002"},
		{name: "invalid exam", tenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c223001", examID: "not-a-uuid"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			handler := &Handler{}
			request := httptest.NewRequest(http.MethodGet, "/v1/tenants/"+testCase.tenantID+"/exams/"+testCase.examID+"/candidate-launch-file", nil)
			request.SetPathValue("tenant_id", testCase.tenantID)
			request.SetPathValue("exam_id", testCase.examID)
			recorder := httptest.NewRecorder()
			handler.getCandidateLaunchFile(recorder, request)
			if recorder.Code == http.StatusOK {
				t.Fatalf("getCandidateLaunchFile accepted invalid IDs, got %d", recorder.Code)
			}
		})
	}
}
