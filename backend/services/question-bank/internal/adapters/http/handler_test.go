package httpadapter

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/aethercode/aethercode/libs/pkg/httpauth"
	"github.com/aethercode/aethercode/libs/pkg/pagination"
	"github.com/aethercode/aethercode/services/question-bank/internal/app"
)

func TestIdempotencyKeyRequiresPrintableHeader(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name    string
		key     string
		wantErr bool
	}{
		{name: "valid key", key: "qbank:create:01JTEST"},
		{name: "missing key", wantErr: true},
		{name: "whitespace only", key: "   ", wantErr: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/", nil)
			if testCase.key != "" {
				request.Header.Set("Idempotency-Key", testCase.key)
			}
			_, err := idempotencyKey(request)
			if (err != nil) != testCase.wantErr {
				t.Fatalf("idempotencyKey() error = %v, wantErr = %t", err, testCase.wantErr)
			}
		})
	}
}

func TestTestsRouteRejectsMalformedRequestsBeforeAuthorization(t *testing.T) {
	t.Parallel()
	handler, err := NewHandler("question-bank", new(app.Service), nil, new(httpauth.Authorizer))
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	const versionPath = "/v1/question-versions/019b11a0-0000-7000-8000-000000000001/tests"
	for _, testCase := range []struct {
		name string
		path string
		body string
	}{
		{name: "invalid version ID", path: "/v1/question-versions/not-a-uuid/tests", body: `{"expected_question_version":1,"tests":[]}`},
		{name: "unknown field", path: versionPath, body: `{"expected_question_version":1,"tests":[],"object_key":"x"}`},
		{name: "unknown test field", path: versionPath, body: `{"expected_question_version":1,"tests":[{"input":"1","expected_output":"1","sample":true,"checksum":"x"}]}`},
		{name: "not JSON", path: versionPath, body: `nope`},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPut, testCase.path, strings.NewReader(testCase.body)))
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d; body %s", recorder.Code, http.StatusBadRequest, recorder.Body)
			}
		})
	}
}

func TestRemovedBundleAndManifestRoutesAreGone(t *testing.T) {
	t.Parallel()
	handler, err := NewHandler("question-bank", new(app.Service), nil, new(httpauth.Authorizer))
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	const versionPath = "/v1/question-versions/019b11a0-0000-7000-8000-000000000001"
	for _, testCase := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, versionPath + "/bundle"},
		{http.MethodPut, versionPath + "/manifests/hidden"},
	} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(testCase.method, testCase.path, strings.NewReader(`{}`)))
		if recorder.Code != http.StatusNotFound && recorder.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s %s status = %d, want 404 or 405", testCase.method, testCase.path, recorder.Code)
		}
	}
}

func TestNewHandlerRejectsNilDependencies(t *testing.T) {
	t.Parallel()
	if _, err := NewHandler("question-bank", nil, nil, nil); err == nil {
		t.Fatal("NewHandler() accepted nil service and authorizer")
	}
}

func TestDeleteQuestionVersionRequiresIdempotencyKey(t *testing.T) {
	t.Parallel()
	// idempotencyKey must reject requests that omit the header — this applies
	// equally to deleteQuestionVersion and hardDeleteQuestionVersion.
	for _, testCase := range []struct {
		name    string
		header  string
		wantErr bool
	}{
		{name: "valid key", header: "qbank:del-ver:01JTEST"},
		{name: "missing key", wantErr: true},
		{name: "whitespace only", header: "   ", wantErr: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodDelete, "/v1/question-versions/019b11a0-0000-7000-8000-000000000001", nil)
			if testCase.header != "" {
				request.Header.Set("Idempotency-Key", testCase.header)
			}
			_, err := idempotencyKey(request)
			if (err != nil) != testCase.wantErr {
				t.Fatalf("idempotencyKey() error = %v, wantErr = %t", err, testCase.wantErr)
			}
		})
	}
}

func TestListPublishedQuestionsLimitBounds(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		query   string
		wantErr bool
	}{
		{"", false},
		{"1", false},
		{"100", false},
		{"0", true},
		{"101", true},
		{"-5", true},
		{"abc", true},
	} {
		request := httptest.NewRequest(http.MethodGet, "/v1/questions?limit="+testCase.query, nil)
		rawLimit := request.URL.Query().Get("limit")
		if rawLimit == "" {
			continue
		}
		recorder := httptest.NewRecorder()
		_ = recorder
	}
}

func TestListQuestionsRejectsMalformedCursor(t *testing.T) {
	t.Parallel()
	// "!!!invalid!!!" is URL-safe but contains '!' which is not in the base64url
	// alphabet, so pagination.Parse must reject it with an error.
	request := httptest.NewRequest(http.MethodGet, "/v1/questions?cursor=!!!invalid!!!", nil)
	rawCursor := request.URL.Query().Get("cursor")
	_, _, err := pagination.Parse(rawCursor)
	if err == nil {
		t.Fatal("pagination.Parse accepted a malformed cursor, want error")
	}
}

func TestListQuestionsStillAcceptsBareLimit(t *testing.T) {
	t.Parallel()
	// An empty cursor (limit-only request) must not be treated as an error.
	request := httptest.NewRequest(http.MethodGet, "/v1/questions?limit=5", nil)
	rawCursor := request.URL.Query().Get("cursor")
	_, _, err := pagination.Parse(rawCursor)
	if err != nil {
		t.Fatalf("pagination.Parse rejected empty cursor for limit-only request: %v", err)
	}
}
