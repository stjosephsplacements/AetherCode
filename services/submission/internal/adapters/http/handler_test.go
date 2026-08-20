package httpadapter

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
)

func TestRequiredIdempotencyKey(t *testing.T) {
	request := httptest.NewRequest("POST", "/", nil)
	if _, err := requiredIdempotencyKey(request); err == nil {
		t.Fatal("missing key must fail")
	}
	request.Header.Set("Idempotency-Key", "request-1")
	key, err := requiredIdempotencyKey(request)
	if err != nil || key != "request-1" {
		t.Fatalf("requiredIdempotencyKey() = %q, %v", key, err)
	}
	request.Header.Set("Idempotency-Key", strings.Repeat("x", 256))
	_, err = requiredIdempotencyKey(request)
	applicationError, ok := err.(*apperrors.Error)
	if !ok || applicationError.Code != apperrors.CodeInvalidArgument {
		t.Fatalf("error = %#v, want invalid argument", err)
	}
}

func TestOptionalUUIDQueryAcceptsEmpty(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if v, err := optionalUUIDQuery(req, "exam_version_id"); err != nil || v != "" {
		t.Fatalf("empty param should return empty string, got %q, %v", v, err)
	}
}

func TestOptionalUUIDQueryRejectsMalformed(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodGet, "/?exam_version_id=not-a-uuid", nil)
	if _, err := optionalUUIDQuery(req, "exam_version_id"); err == nil {
		t.Fatal("malformed UUID must be rejected")
	}
}

func TestOptionalUUIDQueryAcceptsValidUUID(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodGet,
		"/?exam_version_id=018f4b0d-08f8-7c09-9ba7-efdf9c221001", nil)
	v, err := optionalUUIDQuery(req, "exam_version_id")
	if err != nil || v != "018f4b0d-08f8-7c09-9ba7-efdf9c221001" {
		t.Fatalf("valid UUID rejected: %q, %v", v, err)
	}
}
