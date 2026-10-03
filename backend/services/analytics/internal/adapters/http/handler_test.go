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
