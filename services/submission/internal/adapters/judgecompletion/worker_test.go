package judgecompletion

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	judgev1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/judge/v1"
)

const (
	bridgeEventID    = "018f4b0d-08f8-7c09-9ba7-efdf9c220101"
	bridgeJobID      = "018f4b0d-08f8-7c09-9ba7-efdf9c220102"
	bridgeRequestID  = "018f4b0d-08f8-7c09-9ba7-efdf9c220103"
	bridgeDeliveryID = "018f4b0d-08f8-7c09-9ba7-efdf9c220104"
	bridgeLeaseID    = "018f4b0d-08f8-7c09-9ba7-efdf9c220105"
)

func TestWorkerPersistsBeforeAcknowledgingExactLease(t *testing.T) {
	t.Parallel()

	completion := validCompletion()
	store := &recordingStore{}
	client := &recordingClient{completions: []Completion{completion}, store: store}
	worker, err := NewWorker(client, store, testRuntime(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("NewWorker() error = %v", err)
	}
	if err := worker.ProcessOnce(context.Background()); err != nil {
		t.Fatalf("ProcessOnce() error = %v", err)
	}
	if len(store.persisted) != 1 || len(client.acknowledged) != 1 {
		t.Fatalf("persisted=%d acknowledged=%d", len(store.persisted), len(client.acknowledged))
	}
	acknowledged := client.acknowledged[0]
	if acknowledged.JudgeEventID != bridgeEventID || acknowledged.DeliveryID != bridgeDeliveryID || acknowledged.LeaseID != bridgeLeaseID {
		t.Fatalf("acknowledged wrong lease: %#v", acknowledged)
	}
	if !client.persistedBeforeAck {
		t.Fatal("worker acknowledged before durable persistence")
	}
}

func TestWorkerLeavesLeaseUnacknowledgedWhenPersistenceFails(t *testing.T) {
	t.Parallel()

	store := &recordingStore{persistErr: errors.New("database unavailable")}
	client := &recordingClient{completions: []Completion{validCompletion()}}
	worker, err := NewWorker(client, store, testRuntime(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("NewWorker() error = %v", err)
	}
	if err := worker.ProcessOnce(context.Background()); err == nil {
		t.Fatal("ProcessOnce() accepted a persistence failure")
	}
	if len(client.acknowledged) != 0 {
		t.Fatal("worker acknowledged a completion whose persistence failed")
	}
}

func TestParseCompletionRequiresMatchingExplicitVerdict(t *testing.T) {
	t.Parallel()

	value := validProtoCompletion()
	//nolint:staticcheck // SA1019: this test exercises the deprecated verdict field on purpose, to verify parseCompletion still enforces the proto's wire-compatibility contract against verdict_code.
	value.Verdict = "wrong_answer"
	if _, err := parseCompletion(value); err == nil {
		t.Fatal("parseCompletion() accepted a mismatched deprecated verdict")
	}
}

func TestParseCompletionPreservesOptionalMetricsAndEncryptedReference(t *testing.T) {
	t.Parallel()

	value := validProtoCompletion()
	completion, err := parseCompletion(value)
	if err != nil {
		t.Fatalf("parseCompletion() error = %v", err)
	}
	if completion.ExecutionTimeMS == nil || *completion.ExecutionTimeMS != 17 || completion.MemoryKiB == nil || *completion.MemoryKiB != 2048 {
		t.Fatalf("optional metrics = %#v", completion)
	}
	if completion.ResultObjectKey == nil || completion.ResultChecksum == nil || completion.EncryptionKeyReference == nil {
		t.Fatalf("encrypted reference = %#v", completion)
	}
}

func TestParseCompletionMapsUnitResults(t *testing.T) {
	t.Parallel()

	executionTimeMS := uint32(12)
	memoryKiB := uint32(1024)
	overSignedRange := uint32(4000000000)
	testCases := []struct {
		name    string
		units   []*judgev1.UnitResult
		want    []UnitResult
		wantErr bool
	}{
		{name: "absent breakdown becomes an empty list", units: nil, want: []UnitResult{}},
		{
			name: "verdict and optional metrics are preserved per unit",
			units: []*judgev1.UnitResult{
				{UnitNumber: 0, VerdictCode: judgev1.CompletionVerdict_COMPLETION_VERDICT_ACCEPTED, ExecutionTimeMs: &executionTimeMS, MemoryKib: &memoryKiB},
				{UnitNumber: 1, VerdictCode: judgev1.CompletionVerdict_COMPLETION_VERDICT_WRONG_ANSWER},
			},
			want: []UnitResult{
				{UnitNumber: 0, Verdict: "accepted", ExecutionTimeMS: intPointer(12), MemoryKiB: intPointer(1024)},
				{UnitNumber: 1, Verdict: "wrong_answer"},
			},
		},
		{
			name:    "unspecified unit verdict is rejected",
			units:   []*judgev1.UnitResult{{UnitNumber: 0, VerdictCode: judgev1.CompletionVerdict_COMPLETION_VERDICT_UNSPECIFIED}},
			wantErr: true,
		},
		{name: "missing unit result is rejected", units: []*judgev1.UnitResult{nil}, wantErr: true},
		{
			name: "duplicate unit number is rejected",
			units: []*judgev1.UnitResult{
				{UnitNumber: 3, VerdictCode: judgev1.CompletionVerdict_COMPLETION_VERDICT_ACCEPTED},
				{UnitNumber: 3, VerdictCode: judgev1.CompletionVerdict_COMPLETION_VERDICT_ACCEPTED},
			},
			wantErr: true,
		},
		{
			name:    "unit metric beyond Submission's signed range is rejected",
			units:   []*judgev1.UnitResult{{UnitNumber: 0, VerdictCode: judgev1.CompletionVerdict_COMPLETION_VERDICT_ACCEPTED, ExecutionTimeMs: &overSignedRange}},
			wantErr: true,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			value := validProtoCompletion()
			value.UnitResults = testCase.units
			completion, err := parseCompletion(value)
			if testCase.wantErr {
				if err == nil {
					t.Fatalf("parseCompletion() accepted %#v", testCase.units)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseCompletion() error = %v", err)
			}
			if len(completion.UnitResults) != len(testCase.want) {
				t.Fatalf("unit results = %#v, want %#v", completion.UnitResults, testCase.want)
			}
			for index, want := range testCase.want {
				got := completion.UnitResults[index]
				if got.UnitNumber != want.UnitNumber || got.Verdict != want.Verdict ||
					!sameOptionalInt(got.ExecutionTimeMS, want.ExecutionTimeMS) ||
					!sameOptionalInt(got.MemoryKiB, want.MemoryKiB) {
					t.Fatalf("unit %d = %#v, want %#v", index, got, want)
				}
			}
		})
	}
}

func TestValidateRejectsUnboundedUnitBreakdown(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name  string
		units []UnitResult
	}{
		{name: "negative unit number", units: []UnitResult{{UnitNumber: -1, Verdict: "accepted"}}},
		{name: "unknown unit verdict", units: []UnitResult{{UnitNumber: 0, Verdict: "partially_accepted"}}},
		{name: "negative unit metric", units: []UnitResult{{UnitNumber: 0, Verdict: "accepted", MemoryKiB: intPointer(-1)}}},
		{name: "unit metric beyond the database bound", units: []UnitResult{{UnitNumber: 0, Verdict: "accepted", ExecutionTimeMS: intPointer(maxUnitMetric + 1)}}},
		{name: "more units than the database accepts", units: manyUnits(maxUnitResults + 1)},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			completion := validCompletion()
			completion.UnitResults = testCase.units
			if err := completion.Validate(); err == nil {
				t.Fatal("Validate() accepted an out-of-contract unit breakdown")
			}
		})
	}
}

func TestEncodeUnitResultsAlwaysProducesAnArray(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name  string
		units []UnitResult
		want  string
	}{
		{name: "nil breakdown", units: nil, want: "[]"},
		{name: "empty breakdown", units: []UnitResult{}, want: "[]"},
		{
			name:  "populated breakdown keeps every ingress key present",
			units: []UnitResult{{UnitNumber: 2, Verdict: "runtime_error"}},
			want:  `[{"unit_number":2,"verdict":"runtime_error","execution_time_ms":null,"memory_kib":null}]`,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			encoded, err := encodeUnitResults(testCase.units)
			if err != nil {
				t.Fatalf("encodeUnitResults() error = %v", err)
			}
			if encoded != testCase.want {
				t.Fatalf("encodeUnitResults() = %s, want %s", encoded, testCase.want)
			}
		})
	}
}

func intPointer(value int) *int { return &value }

func sameOptionalInt(left, right *int) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func manyUnits(count int) []UnitResult {
	units := make([]UnitResult, 0, count)
	for index := range count {
		units = append(units, UnitResult{UnitNumber: index, Verdict: "accepted"})
	}
	return units
}

func TestLoadRuntimeRejectsEnabledBridgeWithoutMutualTLS(t *testing.T) {
	t.Setenv("JUDGE_COMPLETION_ENABLED", "true")
	t.Setenv("JUDGE_COMPLETION_GRPC_ADDR", "judge.internal:8443")
	t.Setenv("JUDGE_COMPLETION_TLS_CERT_FILE", "")
	t.Setenv("JUDGE_COMPLETION_TLS_KEY_FILE", "")
	t.Setenv("JUDGE_COMPLETION_TLS_CA_FILE", "")

	if _, err := LoadRuntime("development"); err == nil {
		t.Fatal("LoadRuntime() accepted an enabled bridge without mTLS")
	}
}

func validCompletion() Completion {
	return Completion{
		JudgeEventID: bridgeEventID, JudgeJobID: bridgeJobID, EvaluationRequestID: bridgeRequestID,
		DeliveryID: bridgeDeliveryID, LeaseID: bridgeLeaseID, Verdict: "accepted",
		CompletedAt: time.Date(2026, 7, 24, 0, 0, 0, 0, time.UTC),
	}
}

func validProtoCompletion() *judgev1.Completion {
	executionTimeMS := uint32(17)
	memoryKiB := uint32(2048)
	return &judgev1.Completion{
		EventId: bridgeEventID, JobId: bridgeJobID, SubmissionCorrelationId: bridgeRequestID,
		DeliveryId: bridgeDeliveryID, LeaseId: bridgeLeaseID, Verdict: "accepted",
		VerdictCode: judgev1.CompletionVerdict_COMPLETION_VERDICT_ACCEPTED,
		CompletedAt: "2026-07-24T00:00:00Z", ExecutionTimeMs: &executionTimeMS, MemoryKib: &memoryKiB,
		ResultRef:                    "results/018f/output.enc",
		ResultSha256:                 "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		ResultEncryptionKeyReference: "kms://india/keys/results",
	}
}

func testRuntime() Runtime {
	return Runtime{
		Enabled: true, ConsumerID: "submission-judge-completion", BatchSize: 10,
		LeaseSeconds: 60, PollInterval: time.Second, RPCTimeout: time.Second,
	}
}

type recordingClient struct {
	completions        []Completion
	acknowledged       []Completion
	persistedBeforeAck bool
	store              *recordingStore
}

func (client *recordingClient) Pull(context.Context, string, uint32, uint32) ([]Completion, error) {
	return client.completions, nil
}

func (client *recordingClient) Acknowledge(_ context.Context, _ string, completion Completion) error {
	if client.store != nil && len(client.store.persisted) > 0 {
		client.persistedBeforeAck = true
	}
	client.acknowledged = append(client.acknowledged, completion)
	return nil
}

func (client *recordingClient) Close() error { return nil }

type recordingStore struct {
	persisted  []Completion
	persistErr error
}

func (store *recordingStore) Persist(_ context.Context, _ string, completion Completion) error {
	if store.persistErr != nil {
		return store.persistErr
	}
	store.persisted = append(store.persisted, completion)
	return nil
}

func (store *recordingStore) Ping(context.Context) error { return nil }
