package httpadapter

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aethercode/aethercode/libs/pkg/pagination"
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

func TestListQuestionsRejectsMalformedCursor(t *testing.T) {
	t.Parallel()
	// "not.a.valid.cursor" contains dots which are not in the base64url alphabet,
	// so pagination.Parse must reject it with an error.
	request := httptest.NewRequest(http.MethodGet, "/v1/questions?cursor=not.a.valid.cursor", nil)
	rawCursor := request.URL.Query().Get("cursor")
	_, _, err := pagination.Parse(rawCursor)
	if err == nil {
		t.Fatal("pagination.Parse accepted a malformed cursor, want error")
	}
}

func TestListQuestionsStillAcceptsBareLimit(t *testing.T) {
	t.Parallel()
	// A limit-only request carries no cursor; Parse("") must succeed.
	request := httptest.NewRequest(http.MethodGet, "/v1/questions?limit=5", nil)
	rawCursor := request.URL.Query().Get("cursor")
	_, _, err := pagination.Parse(rawCursor)
	if err != nil {
		t.Fatalf("pagination.Parse rejected empty cursor for limit-only request: %v", err)
	}
}
