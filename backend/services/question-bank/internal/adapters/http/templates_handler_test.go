package httpadapter

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGetTemplatesRejectsInvalidVersionID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	recorder := httptest.NewRecorder()
	handler.getTemplates(recorder, httptest.NewRequest(http.MethodGet,
		"/v1/question-versions/not-a-uuid/templates", nil))
	if recorder.Code == http.StatusOK {
		t.Fatalf("getTemplates accepted invalid version UUID, got %d", recorder.Code)
	}
}

func TestSetTemplatesRejectsInvalidVersionID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	recorder := httptest.NewRecorder()
	handler.setTemplates(recorder, httptest.NewRequest(http.MethodPut,
		"/v1/question-versions/not-a-uuid/templates",
		strings.NewReader(`{"templates":{}}`)))
	if recorder.Code == http.StatusOK {
		t.Fatalf("setTemplates accepted invalid version UUID, got %d", recorder.Code)
	}
}

func TestSetTemplatesRejectsNonJSONBody(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPut,
		"/v1/question-versions/018f4b0d-08f8-7c09-9ba7-efdf9c224001/templates",
		strings.NewReader(`not json`))
	request.SetPathValue("question_version_id", "018f4b0d-08f8-7c09-9ba7-efdf9c224001")
	recorder := httptest.NewRecorder()
	handler.setTemplates(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("setTemplates accepted non-JSON body, got %d", recorder.Code)
	}
}

func TestSetTemplatesRejectsUnknownField(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPut,
		"/v1/question-versions/018f4b0d-08f8-7c09-9ba7-efdf9c224001/templates",
		strings.NewReader(`{"templates":{},"rogue":"x"}`))
	request.SetPathValue("question_version_id", "018f4b0d-08f8-7c09-9ba7-efdf9c224001")
	recorder := httptest.NewRecorder()
	handler.setTemplates(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("setTemplates accepted unknown field, got %d", recorder.Code)
	}
}
