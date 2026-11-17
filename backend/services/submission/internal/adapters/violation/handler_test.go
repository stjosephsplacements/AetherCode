package violation

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/stjosephsplacements/AetherCode/libs/pkg/messaging"
)

type fakeSubmitter struct {
	tenantID, attemptID, reason string
	err                         error
}

func (fake *fakeSubmitter) SubmitForViolation(_ context.Context, tenantID, attemptID, reason string) (bool, error) {
	fake.tenantID, fake.attemptID, fake.reason = tenantID, attemptID, reason
	return fake.err == nil, fake.err
}

func TestHandler(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	const (
		attempt = "0190a0a0-0000-7000-8000-000000000001"
		tenant  = "0190a0a0-0000-7000-8000-0000000000aa"
		other   = "0190a0a0-0000-7000-8000-0000000000bb"
	)
	tests := []struct {
		name      string
		payload   string
		err       error
		permanent bool
		wantErr   bool
		submitted bool
	}{
		{"submits", `{"tenant_id":"` + tenant + `","attempt_id":"` + attempt + `","violation_count":5}`, nil, false, false, true},
		{"tenant mismatch", `{"tenant_id":"` + other + `","attempt_id":"` + attempt + `","violation_count":5}`, nil, true, true, false},
		{"bad json", `[]`, nil, true, true, false},
		{"bad attempt id", `{"tenant_id":"` + tenant + `","attempt_id":"x","violation_count":5}`, nil, true, true, false},
		{"zero count", `{"tenant_id":"` + tenant + `","attempt_id":"` + attempt + `","violation_count":0}`, nil, true, true, false},
		{"database failure is retried", `{"tenant_id":"` + tenant + `","attempt_id":"` + attempt + `","violation_count":5}`, errors.New("down"), false, true, true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fake := &fakeSubmitter{err: test.err}
			err := Handler(fake, logger)(context.Background(), messaging.Event{TenantID: tenant, Payload: json.RawMessage(test.payload)})
			if (err != nil) != test.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, test.wantErr)
			}
			var permanent messaging.PermanentError
			if errors.As(err, &permanent) != test.permanent {
				t.Fatalf("permanent = %v, want %v", !test.permanent, test.permanent)
			}
			if (fake.attemptID != "") != test.submitted {
				t.Fatalf("submitter called = %v, want %v", fake.attemptID != "", test.submitted)
			}
			if test.submitted && fake.tenantID != tenant {
				t.Fatalf("tenant = %q, want %q", fake.tenantID, tenant)
			}
			if test.submitted && fake.reason != Reason {
				t.Fatalf("reason = %q", fake.reason)
			}
		})
	}
}
