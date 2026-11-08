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
