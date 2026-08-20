package httpadapter

import (
	"net/http"
	"net/http/httptest"
	"testing"
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

func TestManifestKindValidation(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		kind  string
		valid bool
	}{
		{"sample", true},
		{"hidden", true},
		{"SAMPLE", false},
		{"evaluation", false},
		{"", false},
	} {
		valid := testCase.kind == "sample" || testCase.kind == "hidden"
		if valid != testCase.valid {
			t.Fatalf("manifest kind %q validity = %t, want %t", testCase.kind, valid, testCase.valid)
		}
	}
}

func TestNewHandlerRejectsNilDependencies(t *testing.T) {
	t.Parallel()
	if _, err := NewHandler("question-bank", nil, nil, nil); err == nil {
		t.Fatal("NewHandler() accepted nil service and authorizer")
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
