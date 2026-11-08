package httpadapter

import (
	"net/http/httptest"
	"testing"
)

func TestListRequestPartsRejectsLimitAboveMax(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest("GET",
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c225001/departments?limit=101", nil)
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c225001")

	_, _, _, err := listRequestParts(request)
	if err == nil {
		t.Fatal("listRequestParts() error = nil, want an error for limit > 100")
	}
}

func TestListRequestPartsRejectsMalformedCursor(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest("GET",
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c225001/departments?cursor=!!!", nil)
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c225001")

	_, _, _, err := listRequestParts(request)
	if err == nil {
		t.Fatal("listRequestParts() error = nil, want an error for malformed cursor")
	}
}

func TestListRequestPartsAcceptsValidRequest(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest("GET",
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c225001/departments?limit=10", nil)
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c225001")

	tenantID, limit, cursor, err := listRequestParts(request)
	if err != nil {
		t.Fatalf("listRequestParts() unexpected error: %v", err)
	}
	if tenantID != "018f4b0d-08f8-7c09-9ba7-efdf9c225001" {
		t.Fatalf("tenantID = %q, want %q", tenantID, "018f4b0d-08f8-7c09-9ba7-efdf9c225001")
	}
	if limit != 10 {
		t.Fatalf("limit = %d, want 10", limit)
	}
	if cursor.SortValue != "" || cursor.ID != "" {
		t.Fatalf("cursor = %+v, want zero value", cursor)
	}
}

func TestListRequestPartsUsesDefaultLimit(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest("GET",
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c225001/departments", nil)
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c225001")

	_, limit, _, err := listRequestParts(request)
	if err != nil {
		t.Fatalf("listRequestParts() unexpected error: %v", err)
	}
	if limit != 20 {
		t.Fatalf("default limit = %d, want 20", limit)
	}
}

func TestListRequestPartsRejectsInvalidTenantID(t *testing.T) {
	t.Parallel()
	// No path value set — ParseUUIDPathValue should reject an empty string.
	request := httptest.NewRequest("GET", "/v1/tenants/not-a-uuid/departments", nil)

	_, _, _, err := listRequestParts(request)
	if err == nil {
		t.Fatal("listRequestParts() error = nil, want an error for invalid tenant UUID")
	}
}
