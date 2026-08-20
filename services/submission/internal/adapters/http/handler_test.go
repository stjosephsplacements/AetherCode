package httpadapter

import (
	"net/http/httptest"
	"strings"
	"testing"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/pagination"
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

func TestParseLimitRejectsZero(t *testing.T) {
	t.Parallel()
	if _, err := pagination.ParseLimit("0", 20, 100); err == nil {
		t.Fatal("limit=0 must fail")
	}
}

func TestParseCursorRejectsMalformed(t *testing.T) {
	t.Parallel()
	if _, _, err := pagination.Parse("!!!"); err == nil {
		t.Fatal("cursor=!!! must fail")
	}
}
