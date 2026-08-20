package httpx

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
)

func TestDecodeJSONRejectsUnknownAndTrailingValues(t *testing.T) {
	t.Parallel()
	for _, body := range []string{`{"known":"value","unknown":true}`, `{"known":"value"} {}`} {
		request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
		var value struct {
			Known string `json:"known"`
		}
		if err := DecodeJSON(request, &value); err == nil {
			t.Fatalf("DecodeJSON() accepted %q", body)
		}
	}
}

func TestDecodeJSONRawReturnsExactValidatedBody(t *testing.T) {
	t.Parallel()
	body := `{"known":"value"}`
	request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	var value struct {
		Known string `json:"known"`
	}
	raw, err := DecodeJSONRaw(request, &value)
	if err != nil || string(raw) != body || value.Known != "value" {
		t.Fatalf("DecodeJSONRaw() = %q, %#v, %v", raw, value, err)
	}
}

func TestWriteErrorMapsApplicationErrors(t *testing.T) {
	t.Parallel()
	response := httptest.NewRecorder()
	WriteError(response, apperrors.New(apperrors.CodeForbidden, "access denied"))
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
	if !strings.Contains(response.Body.String(), `"code":"forbidden"`) {
		t.Fatalf("body = %s", response.Body.String())
	}
}

func TestBearerToken(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set("Authorization", "Bearer signed-value")
	token, err := BearerToken(request)
	if err != nil || token != "signed-value" {
		t.Fatalf("BearerToken() = %q, %v", token, err)
	}
}

func TestParseEnumQuery(t *testing.T) {
	t.Parallel()
	testCases := []struct {
		name      string
		query     string
		want      string
		wantError bool
	}{
		{name: "absent is allowed", query: "", want: ""},
		{name: "allowed value", query: "?state=active", want: "active"},
		{name: "rejected value", query: "?state=nonsense", wantError: true},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			request := httptest.NewRequest(http.MethodGet, "/v1/things"+testCase.query, nil)
			got, err := ParseEnumQuery(request, "state", "active", "closed")
			if testCase.wantError {
				if err == nil {
					t.Fatalf("ParseEnumQuery(%q) error = nil, want an error", testCase.query)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseEnumQuery(%q) error = %v", testCase.query, err)
			}
			if got != testCase.want {
				t.Fatalf("ParseEnumQuery(%q) = %q, want %q", testCase.query, got, testCase.want)
			}
		})
	}
}
