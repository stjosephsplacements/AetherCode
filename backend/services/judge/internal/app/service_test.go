package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aethercode/aethercode/services/judge/internal/dispatcher"
)

func TestSubmitRejectsOutOfRangeWallTimeBeforePersistence(t *testing.T) {
	t.Parallel()

	store := &recordingStore{}
	service := NewService(store)
	service.now = func() time.Time { return time.Date(2026, 7, 24, 0, 0, 0, 0, time.UTC) }
	request := validRequest()
	request.Limits.WallTimeMS = 120001

	if _, err := service.Submit(context.Background(), request); err == nil {
		t.Fatal("Submit accepted an invalid execution")
	}
	if store.submitted {
		t.Fatal("invalid request reached persistence")
	}
}

func TestFingerprintExcludesIdempotencyKeyAndBindsPayload(t *testing.T) {
	t.Parallel()

	first := validRequest()
	second := first
	second.IdempotencyKey = "different-key"
	firstFingerprint, err := first.Fingerprint()
	if err != nil {
		t.Fatalf("first Fingerprint returned error: %v", err)
	}
	secondFingerprint, err := second.Fingerprint()
	if err != nil {
		t.Fatalf("second Fingerprint returned error: %v", err)
	}
	if firstFingerprint != secondFingerprint {
		t.Fatal("idempotency key unexpectedly changed request fingerprint")
	}
	second.LanguageKey = "python-3.14"
	changedFingerprint, err := second.Fingerprint()
	if err != nil {
		t.Fatalf("changed Fingerprint returned error: %v", err)
	}
	if firstFingerprint == changedFingerprint {
		t.Fatal("payload change did not change request fingerprint")
	}
}

func TestCompletionValidateRejectsUnrecognizedVerdicts(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		mutate    func(*Completion)
		wantField string
	}{
		{
			name:      "aggregate verdict is unrecognized",
			mutate:    func(completion *Completion) { completion.Verdict = "not-a-real-verdict" },
			wantField: "verdict",
		},
		{
			name: "unit verdict is unrecognized",
			mutate: func(completion *Completion) {
				completion.UnitResults = []dispatcher.UnitResult{{UnitNumber: 0, Verdict: "not-a-real-verdict"}}
			},
			wantField: "unit_results.verdict",
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			completion := validCompletion()
			testCase.mutate(&completion)

			err := completion.Validate()
			var validationError *ValidationError
			if !errors.As(err, &validationError) {
				t.Fatalf("Validate() error = %v, want *ValidationError", err)
			}
			if validationError.Field != testCase.wantField {
				t.Fatalf("Validate() field = %q, want %q", validationError.Field, testCase.wantField)
			}
		})
	}
}

func validCompletion() Completion {
	return Completion{
		EventID:                 "019b11a0-0000-7000-8000-000000000020",
		JobID:                   "019b11a0-0000-7000-8000-000000000021",
		SubmissionCorrelationID: "019b11a0-0000-7000-8000-000000000022",
		DeliveryID:              "019b11a0-0000-7000-8000-000000000023",
		LeaseID:                 "019b11a0-0000-7000-8000-000000000024",
		Verdict:                 "accepted",
		CompletedAt:             time.Date(2026, 7, 24, 0, 0, 0, 0, time.UTC),
	}
}

func validRequest() SubmitExecution {
	return SubmitExecution{
		IdempotencyKey:          "submission-1",
		TenantFairnessKey:       "opaque-tenant-key",
		SubmissionCorrelationID: "0189c7a1-2f00-7000-8000-000000000001",
		EvaluationBundleRef:     "encrypted/evaluations/1",
		EvaluationBundleSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		SourceCiphertextRef:     "encrypted/sources/1",
		SourceCiphertextSHA256:  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		RequestCiphertextRef:    "encrypted/requests/1",
		LanguageKey:             "go-1.26",
		Limits: Limits{
			CPUTimeMS:  1000,
			WallTimeMS: 2000,
			Memory:     64 * 1024 * 1024,
			Processes:  32,
		},
		ExpiresAt: time.Date(2026, 7, 24, 0, 5, 0, 0, time.UTC),
	}
}

type recordingStore struct {
	submitted bool
}

func (store *recordingStore) Submit(context.Context, SubmitExecution) (Execution, error) {
	store.submitted = true
	return Execution{}, nil
}

func (store *recordingStore) Pull(context.Context, PullCompletedExecutions) ([]Completion, error) {
	return nil, nil
}

func (store *recordingStore) Acknowledge(context.Context, AcknowledgeCompletion) error {
	return nil
}

func (store *recordingStore) SoftDeleteExecutionJob(context.Context, DeleteExecutionJob) error {
	return nil
}

func (store *recordingStore) HardDeleteExecutionJob(context.Context, DeleteExecutionJob) error {
	return nil
}

func (store *recordingStore) Ping(context.Context) error {
	return nil
}
