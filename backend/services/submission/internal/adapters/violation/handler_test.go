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
	attemptID, reason string
	err               error
}

func (fake *fakeSubmitter) SubmitForViolation(_ context.Context, attemptID, reason string) (bool, error) {
	fake.attemptID, fake.reason = attemptID, reason
	return fake.err == nil, fake.err
}

func TestHandler(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	const attempt = "0190a0a0-0000-7000-8000-000000000001"
	tests := []struct {
		name      string
		payload   string
		err       error
		permanent bool
		wantErr   bool
		submitted bool
	}{
		{"submits", `{"tenant_id":"t1","attempt_id":"` + attempt + `","violation_count":5}`, nil, false, false, true},
		{"tenant mismatch", `{"tenant_id":"t2","attempt_id":"` + attempt + `","violation_count":5}`, nil, true, true, false},
		{"bad json", `[]`, nil, true, true, false},
		{"bad attempt id", `{"tenant_id":"t1","attempt_id":"x","violation_count":5}`, nil, true, true, false},
		{"zero count", `{"tenant_id":"t1","attempt_id":"` + attempt + `","violation_count":0}`, nil, true, true, false},
		{"database failure is retried", `{"tenant_id":"t1","attempt_id":"` + attempt + `","violation_count":5}`, errors.New("down"), false, true, true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fake := &fakeSubmitter{err: test.err}
			err := Handler(fake, logger)(context.Background(), messaging.Event{TenantID: "t1", Payload: json.RawMessage(test.payload)})
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
			if test.submitted && fake.reason != Reason {
				t.Fatalf("reason = %q", fake.reason)
			}
		})
	}
}
