package httpadapter

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestListTagsRejectsLimitBelowOne(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	recorder := httptest.NewRecorder()
	handler.listTags(recorder, httptest.NewRequest(http.MethodGet, "/v1/tags?limit=0", nil))
	if recorder.Code == http.StatusOK {
		t.Fatalf("listTags accepted limit=0, got %d", recorder.Code)
	}
}

func TestListTagsRejectsLimitAboveMax(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	recorder := httptest.NewRecorder()
	handler.listTags(recorder, httptest.NewRequest(http.MethodGet, "/v1/tags?limit=501", nil))
	if recorder.Code == http.StatusOK {
		t.Fatalf("listTags accepted limit=501, got %d", recorder.Code)
	}
}

func TestListTagsRejectsNonNumericLimit(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	recorder := httptest.NewRecorder()
	handler.listTags(recorder, httptest.NewRequest(http.MethodGet, "/v1/tags?limit=abc", nil))
	if recorder.Code == http.StatusOK {
		t.Fatalf("listTags accepted non-numeric limit, got %d", recorder.Code)
	}
}

func TestRenameCategoryRejectsInvalidCategoryID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	recorder := httptest.NewRecorder()
	handler.renameCategory(recorder, httptest.NewRequest(http.MethodPatch,
		"/v1/categories/not-a-uuid", strings.NewReader(`{"name":"Arrays"}`)))
	if recorder.Code == http.StatusOK {
		t.Fatalf("renameCategory accepted invalid UUID, got %d", recorder.Code)
	}
}

func TestRenameCategoryRejectsEmptyUpdate(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPatch,
		"/v1/categories/018f4b0d-08f8-7c09-9ba7-efdf9c224001",
		strings.NewReader(`{}`))
	request.SetPathValue("category_id", "018f4b0d-08f8-7c09-9ba7-efdf9c224001")
	recorder := httptest.NewRecorder()
	handler.renameCategory(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("renameCategory accepted empty update (no name or parent_id), got %d", recorder.Code)
	}
}

func TestRenameCategoryRejectsNonStringParentID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPatch,
		"/v1/categories/018f4b0d-08f8-7c09-9ba7-efdf9c224001",
		// parent_id is a number, not a string — must reject before auth
		strings.NewReader(`{"parent_id":42}`))
	request.SetPathValue("category_id", "018f4b0d-08f8-7c09-9ba7-efdf9c224001")
	recorder := httptest.NewRecorder()
	handler.renameCategory(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("renameCategory accepted numeric parent_id, got %d", recorder.Code)
	}
}

func TestDeleteCategoryRejectsInvalidCategoryID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	recorder := httptest.NewRecorder()
	handler.deleteCategory(recorder, httptest.NewRequest(http.MethodDelete,
		"/v1/categories/not-a-uuid", nil))
	if recorder.Code == http.StatusOK {
		t.Fatalf("deleteCategory accepted invalid UUID, got %d", recorder.Code)
	}
}

func TestSetQuestionCategoryRejectsInvalidQuestionID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	recorder := httptest.NewRecorder()
	handler.setQuestionCategory(recorder, httptest.NewRequest(http.MethodPut,
		"/v1/questions/not-a-uuid/category", strings.NewReader(`{"category_id":"018f4b0d-08f8-7c09-9ba7-efdf9c224001"}`)))
	if recorder.Code == http.StatusOK {
		t.Fatalf("setQuestionCategory accepted invalid question UUID, got %d", recorder.Code)
	}
}

func TestSetQuestionTagsRejectsInvalidQuestionID(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	recorder := httptest.NewRecorder()
	handler.setQuestionTags(recorder, httptest.NewRequest(http.MethodPut,
		"/v1/questions/not-a-uuid/tags", strings.NewReader(`{"tags":["arrays"]}`)))
	if recorder.Code == http.StatusOK {
		t.Fatalf("setQuestionTags accepted invalid question UUID, got %d", recorder.Code)
	}
}

func TestSetQuestionTagsRejectsNonJSONBody(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	request := httptest.NewRequest(http.MethodPut,
		"/v1/questions/018f4b0d-08f8-7c09-9ba7-efdf9c224001/tags",
		strings.NewReader(`not json`))
	request.SetPathValue("question_id", "018f4b0d-08f8-7c09-9ba7-efdf9c224001")
	recorder := httptest.NewRecorder()
	handler.setQuestionTags(recorder, request)
	if recorder.Code == http.StatusOK {
		t.Fatalf("setQuestionTags accepted non-JSON body, got %d", recorder.Code)
	}
}
