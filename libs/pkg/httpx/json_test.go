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
