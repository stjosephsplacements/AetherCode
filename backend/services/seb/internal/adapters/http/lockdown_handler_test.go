package httpadapter

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stjosephsplacements/AetherCode/services/seb/internal/app"
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

const launchPath = "/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c223001/exams/018f4b0d-08f8-7c09-9ba7-efdf9c223002/"

// A ticket in the query replaces the bearer: the authorizer is never consulted.
func TestLaunchFileWithTicketSkipsAuthorization(t *testing.T) {
	t.Parallel()
	service := &fakeSEBService{launchFile: app.LaunchFile{Filename: "x.seb", Content: []byte("seb")}}
	authorizer := &fakeAuthorizer{}
	handler, err := NewHandler("seb", service, func(context.Context) error { return nil }, authorizer)
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, launchPath+"launch-file?ticket=abc", nil))
	if recorder.Code != http.StatusOK || service.ticketUsed != "abc" {
		t.Fatalf("status = %d, ticket = %q", recorder.Code, service.ticketUsed)
	}
	if authorizer.selfCalls+authorizer.regularCall != 0 {
		t.Fatal("a ticketed download must not need a bearer")
	}
	if recorder.Header().Get("Cache-Control") != "no-store" {
		t.Error("the launch file must not be cached")
	}
}

func TestIssueLaunchTicketIsCandidateSelfAndNotCached(t *testing.T) {
	t.Parallel()
	authorizer := &fakeAuthorizer{}
	handler, err := NewHandler("seb", &fakeSEBService{}, func(context.Context) error { return nil }, authorizer)
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, launchPath+"launch-ticket", nil))
	if recorder.Code != http.StatusCreated || authorizer.selfCalls != 1 || authorizer.regularCall != 0 {
		t.Fatalf("status = %d, self = %d, regular = %d", recorder.Code, authorizer.selfCalls, authorizer.regularCall)
	}
	if !strings.Contains(recorder.Body.String(), `"ticket":"issued-ticket"`) || !strings.Contains(recorder.Body.String(), `"expires_in":60`) {
		t.Errorf("body = %s", recorder.Body.String())
	}
	if recorder.Header().Get("Cache-Control") != "no-store" {
		t.Error("a ticket response must not be cached")
	}
}
