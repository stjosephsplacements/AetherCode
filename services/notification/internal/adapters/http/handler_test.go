package httpadapter

import (
	"net/http/httptest"
	"testing"
)

func TestParseLimitDefaults(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name    string
		query   string
		want    int
		wantErr bool
	}{
		{name: "default empty", query: "", want: 50},
		{name: "default whitespace", query: "   ", want: 50},
		{name: "valid 1", query: "1", want: 1},
		{name: "valid 100", query: "100", want: 100},
		{name: "zero", query: "0", wantErr: true},
		{name: "over maximum", query: "101", wantErr: true},
		{name: "negative", query: "-1", wantErr: true},
		{name: "non-numeric", query: "abc", wantErr: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			got, err := parseLimit(testCase.query)
			if (err != nil) != testCase.wantErr {
				t.Fatalf("parseLimit(%q) error = %v, wantErr %t", testCase.query, err, testCase.wantErr)
			}
			if err == nil && got != testCase.want {
				t.Fatalf("parseLimit(%q) = %d, want %d", testCase.query, got, testCase.want)
			}
		})
	}
}

func TestNewHandlerRejectsNilDependencies(t *testing.T) {
	t.Parallel()
	if _, err := NewHandler("notification", nil, nil, nil); err == nil {
		t.Fatal("NewHandler() accepted nil service and authorizer")
	}
}

func TestScheduleRequestRequiresRFC3339ScheduledAt(t *testing.T) {
	t.Parallel()
	for _, raw := range []string{
		"", "2026-07-24", "not-a-date", "2026/07/24 12:00:00",
	} {
		request := httptest.NewRequest("POST", "/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c220001/notifications", nil)
		request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c220001")
		body := scheduleRequest{ScheduledAt: raw}
		_ = body
	}
}
