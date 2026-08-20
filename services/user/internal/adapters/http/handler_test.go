package httpadapter

import (
	"net/http/httptest"
	"testing"
)

const userIdempotencyKey = "018f4b0d-08f8-7c09-9ba7-efdf9c220921"

func TestRequiredIdempotencyKeyRequiresUUIDHeader(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest("PUT", "/v1/tenants/example/students/example/batch-affiliation", nil)
	if _, err := requiredIdempotencyKey(request); err == nil {
		t.Fatal("requiredIdempotencyKey() accepted a missing header")
	}
	request.Header.Set("Idempotency-Key", "not-a-uuid")
	if _, err := requiredIdempotencyKey(request); err == nil {
		t.Fatal("requiredIdempotencyKey() accepted a malformed UUID header")
	}
	request.Header.Set("Idempotency-Key", userIdempotencyKey)
	key, err := requiredIdempotencyKey(request)
	if err != nil || key != userIdempotencyKey {
		t.Fatalf("requiredIdempotencyKey() = %q, %v", key, err)
	}
}
