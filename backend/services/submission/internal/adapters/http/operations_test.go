package httpadapter

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRecordIntegrityEventRejectsInvalidTenantID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPost,
		"/v1/tenants/not-a-uuid/attempts/018f4b0d-08f8-7c09-9ba7-efdf9c226001/events",
		strings.NewReader(`{"kind":"focus_loss"}`))
	request.SetPathValue("attempt_id", "018f4b0d-08f8-7c09-9ba7-efdf9c226001")
	recorder := httptest.NewRecorder()
	handler.recordIntegrityEvent(recorder, request)
	if recorder.Code == http.StatusNoContent {
		t.Fatalf("recordIntegrityEvent accepted invalid tenant UUID, got %d", recorder.Code)
	}
}

func TestRecordIntegrityEventRejectsInvalidAttemptID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPost,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c226001/attempts/not-a-uuid/events",
		strings.NewReader(`{"kind":"focus_loss"}`))
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c226001")
	request.SetPathValue("attempt_id", "not-a-uuid")
	recorder := httptest.NewRecorder()
	handler.recordIntegrityEvent(recorder, request)
	if recorder.Code == http.StatusNoContent {
		t.Fatalf("recordIntegrityEvent accepted invalid attempt UUID, got %d", recorder.Code)
	}
}

func TestRecordIntegrityEventRejectsNonJSONBody(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPost,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c226001/attempts/018f4b0d-08f8-7c09-9ba7-efdf9c226002/events",
		strings.NewReader(`not json`))
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c226001")
	request.SetPathValue("attempt_id", "018f4b0d-08f8-7c09-9ba7-efdf9c226002")
	recorder := httptest.NewRecorder()
	handler.recordIntegrityEvent(recorder, request)
	if recorder.Code == http.StatusNoContent {
		t.Fatalf("recordIntegrityEvent accepted non-JSON body, got %d", recorder.Code)
	}
}

func TestSaveChoiceRejectsInvalidIDs(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name       string
		tenantID   string
		attemptID  string
		examItemID string
	}{
		{name: "invalid tenant", tenantID: "not-a-uuid", attemptID: "018f4b0d-08f8-7c09-9ba7-efdf9c226002", examItemID: "018f4b0d-08f8-7c09-9ba7-efdf9c226003"},
		{name: "invalid attempt", tenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c226001", attemptID: "not-a-uuid", examItemID: "018f4b0d-08f8-7c09-9ba7-efdf9c226003"},
		{name: "invalid item", tenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c226001", attemptID: "018f4b0d-08f8-7c09-9ba7-efdf9c226002", examItemID: "not-a-uuid"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			handler := &Handler{}
			request := httptest.NewRequest(http.MethodPut,
				"/v1/tenants/"+testCase.tenantID+"/attempts/"+testCase.attemptID+"/choices/"+testCase.examItemID,
				strings.NewReader(`{"selected":[0]}`))
			request.SetPathValue("tenant_id", testCase.tenantID)
			request.SetPathValue("attempt_id", testCase.attemptID)
			request.SetPathValue("exam_item_id", testCase.examItemID)
			recorder := httptest.NewRecorder()
			handler.saveChoice(recorder, request)
			if recorder.Code == http.StatusOK {
				t.Fatalf("saveChoice accepted invalid IDs, got %d", recorder.Code)
			}
		})
	}
}

func TestRegradeItemRejectsInvalidExamItemID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPost,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c226001/exam-versions/018f4b0d-08f8-7c09-9ba7-efdf9c226002/items/not-a-uuid/regrade",
		nil)
	request.SetPathValue("exam_item_id", "not-a-uuid")
	recorder := httptest.NewRecorder()
	handler.regradeItem(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("regradeItem accepted invalid exam item UUID, got %d", recorder.Code)
	}
}

func TestGetAttemptLiveStateRejectsInvalidTenantID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/not-a-uuid/attempts/018f4b0d-08f8-7c09-9ba7-efdf9c226002/live", nil)
	recorder := httptest.NewRecorder()
	handler.getAttemptLiveState(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("getAttemptLiveState accepted invalid tenant UUID, got %d", recorder.Code)
	}
}

func TestGetAttemptResultRejectsInvalidAttemptID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c226001/attempts/not-a-uuid/result", nil)
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c226001")
	request.SetPathValue("attempt_id", "not-a-uuid")
	recorder := httptest.NewRecorder()
	handler.getAttemptResult(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("getAttemptResult accepted invalid attempt UUID, got %d", recorder.Code)
	}
}
