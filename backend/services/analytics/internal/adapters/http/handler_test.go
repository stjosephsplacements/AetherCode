package httpadapter

import (
	"net/http/httptest"
	"testing"
)

func TestParseLimit(t *testing.T) {
	request := httptest.NewRequest("GET", "/v1?limit=25", nil)
	limit, err := parseLimit(request)
	if err != nil || limit != 25 {
		t.Fatalf("parseLimit() = %d, %v", limit, err)
	}
	for _, raw := range []string{"0", "501", "nope"} {
		request := httptest.NewRequest("GET", "/v1?limit="+raw, nil)
		if _, err := parseLimit(request); err == nil {
			t.Fatalf("parseLimit(%q) accepted invalid value", raw)
		}
	}
}

func TestParseLimitUpTo(t *testing.T) {
	r := httptest.NewRequest("GET", "/v1?limit=5000", nil)
	if limit, err := parseLimitUpTo(r, 5000); err != nil || limit != 5000 {
		t.Fatalf("parseLimitUpTo(5000) = %d, %v", limit, err)
	}
	r = httptest.NewRequest("GET", "/v1?limit=5001", nil)
	if _, err := parseLimitUpTo(r, 5000); err == nil {
		t.Fatal("parseLimitUpTo accepted value above maximum")
	}
}

func TestTenantResourceAndLimitRejectsInvalidTenantID(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest("GET", "/v1/tenants/not-a-uuid/batches/018f4b0d-08f8-7c09-9ba7-efdf9c227001/progress", nil)
	request.SetPathValue("batch_id", "018f4b0d-08f8-7c09-9ba7-efdf9c227001")
	if _, _, _, err := tenantResourceAndLimit(request, "batch_id"); err == nil {
		t.Fatal("tenantResourceAndLimit accepted invalid tenant UUID")
	}
}

func TestTenantResourceAndLimitRejectsInvalidResourceID(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest("GET", "/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c227001/batches/not-a-uuid/progress", nil)
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c227001")
	request.SetPathValue("batch_id", "not-a-uuid")
	if _, _, _, err := tenantResourceAndLimit(request, "batch_id"); err == nil {
		t.Fatal("tenantResourceAndLimit accepted invalid resource UUID")
	}
}

func TestTenantResourceAndLimitRejectsInvalidLimit(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest("GET", "/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c227001/batches/018f4b0d-08f8-7c09-9ba7-efdf9c227002/progress?limit=999", nil)
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c227001")
	request.SetPathValue("batch_id", "018f4b0d-08f8-7c09-9ba7-efdf9c227002")
	if _, _, _, err := tenantResourceAndLimit(request, "batch_id"); err == nil {
		t.Fatal("tenantResourceAndLimit accepted limit above maximum")
	}
}

func TestRequiredIdempotencyKeyRejectsMissingKey(t *testing.T) {
	t.Parallel()
	if _, err := requiredIdempotencyKey(httptest.NewRequest("POST", "/v1/exports", nil)); err == nil {
		t.Fatal("requiredIdempotencyKey accepted missing header")
	}
}

func TestRequiredIdempotencyKeyRejectsOversizeKey(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest("POST", "/v1/exports", nil)
	request.Header.Set("Idempotency-Key", string(make([]byte, 256)))
	if _, err := requiredIdempotencyKey(request); err == nil {
		t.Fatal("requiredIdempotencyKey accepted key longer than 255 chars")
	}
}

func TestRequiredIdempotencyKeyAcceptsValidKey(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest("POST", "/v1/exports", nil)
	request.Header.Set("Idempotency-Key", "export:2026-11-08:batchA")
	got, err := requiredIdempotencyKey(request)
	if err != nil || got != "export:2026-11-08:batchA" {
		t.Fatalf("requiredIdempotencyKey() = %q, %v", got, err)
	}
}
