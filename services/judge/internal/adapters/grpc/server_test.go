package grpcadapter

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/ratelimit"
	judgev1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/judge/v1"
	"github.com/aethercode/aethercode/services/judge/internal/app"
	"github.com/aethercode/aethercode/services/judge/internal/dispatcher"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type recordingStore struct{}

func (store *recordingStore) Submit(context.Context, app.SubmitExecution) (app.Execution, error) {
	return app.Execution{ID: "019b11a0-0000-7000-8000-000000000010", Status: "queued"}, nil
}

func (store *recordingStore) Pull(context.Context, app.PullCompletedExecutions) ([]app.Completion, error) {
	return nil, nil
}

func (store *recordingStore) Acknowledge(context.Context, app.AcknowledgeCompletion) error {
	return nil
}

func (store *recordingStore) SoftDeleteExecutionJob(context.Context, app.DeleteExecutionJob) error {
	return nil
}

func (store *recordingStore) HardDeleteExecutionJob(context.Context, app.DeleteExecutionJob) error {
	return nil
}

func (store *recordingStore) Ping(context.Context) error { return nil }

// deleteAssertingStore records the commands passed to the soft/hard delete
// store methods and lets tests inject a store-layer error to exercise
// toStatusError mapping.
type deleteAssertingStore struct {
	recordingStore
	softDeleteCalls []app.DeleteExecutionJob
	hardDeleteCalls []app.DeleteExecutionJob
	softDeleteErr   error
	hardDeleteErr   error
}

func (store *deleteAssertingStore) SoftDeleteExecutionJob(_ context.Context, command app.DeleteExecutionJob) error {
	store.softDeleteCalls = append(store.softDeleteCalls, command)
	return store.softDeleteErr
}

func (store *deleteAssertingStore) HardDeleteExecutionJob(_ context.Context, command app.DeleteExecutionJob) error {
	store.hardDeleteCalls = append(store.hardDeleteCalls, command)
	return store.hardDeleteErr
}

// pullStubStore returns a fixed set of completions from Pull, letting tests
// assert how PullCompletedExecutions maps app.Completion (including its
// per-unit detail) into the wire response.
type pullStubStore struct {
	recordingStore
	completions []app.Completion
}

func (store *pullStubStore) Pull(context.Context, app.PullCompletedExecutions) ([]app.Completion, error) {
	return store.completions, nil
}

func uint32Ptr(v uint32) *uint32 { return &v }

func TestPullCompletedExecutionsMapsUnitResults(t *testing.T) {
	t.Parallel()

	completedAt := time.Now().UTC()
	timeMS, memoryKB := 120, 512

	tests := []struct {
		name        string
		unitResults []dispatcher.UnitResult
		wantCode    codes.Code
		wantUnits   []*judgev1.UnitResult
	}{
		{
			name: "maps unit_number, verdict, timing, and memory for every unit in order",
			unitResults: []dispatcher.UnitResult{
				{UnitNumber: 0, Verdict: "accepted", TimeMS: &timeMS, MemoryKB: &memoryKB},
				{UnitNumber: 1, Verdict: "wrong_answer"},
			},
			wantCode: codes.OK,
			wantUnits: []*judgev1.UnitResult{
				{
					UnitNumber:      0,
					VerdictCode:     judgev1.CompletionVerdict_COMPLETION_VERDICT_ACCEPTED,
					ExecutionTimeMs: uint32Ptr(120),
					MemoryKib:       uint32Ptr(512),
				},
				{UnitNumber: 1, VerdictCode: judgev1.CompletionVerdict_COMPLETION_VERDICT_WRONG_ANSWER},
			},
		},
		{
			name:        "no units yields an empty, non-nil unit_results list",
			unitResults: nil,
			wantCode:    codes.OK,
			wantUnits:   []*judgev1.UnitResult{},
		},
		{
			name:        "unrecognized unit verdict fails closed with Internal instead of a mismapped verdict",
			unitResults: []dispatcher.UnitResult{{UnitNumber: 0, Verdict: "not-a-real-verdict"}},
			wantCode:    codes.Internal,
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			store := &pullStubStore{completions: []app.Completion{{
				EventID:                 "019b11a0-0000-7000-8000-000000000020",
				JobID:                   "019b11a0-0000-7000-8000-000000000021",
				SubmissionCorrelationID: "019b11a0-0000-7000-8000-000000000022",
				Verdict:                 "wrong_answer",
				DeliveryID:              "019b11a0-0000-7000-8000-000000000023",
				LeaseID:                 "019b11a0-0000-7000-8000-000000000024",
				CompletedAt:             completedAt,
				UnitResults:             testCase.unitResults,
			}}}
			server := NewServer(app.NewService(store), nil)

			response, err := server.PullCompletedExecutions(context.Background(), &judgev1.PullCompletedExecutionsRequest{
				ConsumerId:   "consumer-1",
				Limit:        10,
				LeaseSeconds: 30,
			})
			if status.Code(err) != testCase.wantCode {
				t.Fatalf("PullCompletedExecutions() status = %v, want %v (err=%v)", status.Code(err), testCase.wantCode, err)
			}
			if testCase.wantCode != codes.OK {
				return
			}

			completions := response.GetCompletions()
			if len(completions) != 1 {
				t.Fatalf("completions len = %d, want 1", len(completions))
			}
			gotUnits := completions[0].GetUnitResults()
			if len(gotUnits) != len(testCase.wantUnits) {
				t.Fatalf("unit_results len = %d, want %d", len(gotUnits), len(testCase.wantUnits))
			}
			for i, want := range testCase.wantUnits {
				got := gotUnits[i]
				if got.GetUnitNumber() != want.GetUnitNumber() {
					t.Fatalf("unit %d: unit_number = %d, want %d", i, got.GetUnitNumber(), want.GetUnitNumber())
				}
				if got.GetVerdictCode() != want.GetVerdictCode() {
					t.Fatalf("unit %d: verdict_code = %v, want %v", i, got.GetVerdictCode(), want.GetVerdictCode())
				}
				if (got.ExecutionTimeMs == nil) != (want.ExecutionTimeMs == nil) ||
					(got.ExecutionTimeMs != nil && got.GetExecutionTimeMs() != want.GetExecutionTimeMs()) {
					t.Fatalf("unit %d: execution_time_ms = %v, want %v", i, got.ExecutionTimeMs, want.ExecutionTimeMs)
				}
				if (got.MemoryKib == nil) != (want.MemoryKib == nil) ||
					(got.MemoryKib != nil && got.GetMemoryKib() != want.GetMemoryKib()) {
					t.Fatalf("unit %d: memory_kib = %v, want %v", i, got.MemoryKib, want.MemoryKib)
				}
			}
		})
	}
}

func validSubmitExecutionRequest(tenantFairnessKey string) *judgev1.SubmitExecutionRequest {
	return &judgev1.SubmitExecutionRequest{
		IdempotencyKey:          "submission-1",
		TenantFairnessKey:       tenantFairnessKey,
		SubmissionCorrelationId: "0189c7a1-2f00-7000-8000-000000000001",
		EvaluationBundleRef:     "encrypted/evaluations/1",
		EvaluationBundleSha256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		SourceCiphertextRef:     "encrypted/sources/1",
		SourceCiphertextSha256:  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		RequestCiphertextRef:    "encrypted/requests/1",
		LanguageKey:             "go-1.26",
		Limits: &judgev1.ExecutionLimits{
			CpuTimeMs:    1000,
			WallTimeMs:   2000,
			MemoryBytes:  64 * 1024 * 1024,
			ProcessLimit: 32,
		},
		ExpiresAt: time.Now().UTC().Add(5 * time.Minute).Format(time.RFC3339Nano),
	}
}

func TestSubmitExecutionRateLimitReturnsResourceExhaustedAfterBurstExhausted(t *testing.T) {
	t.Parallel()

	limiter, err := ratelimit.New(ratelimit.Config{
		Capacity:        1,
		RefillPerSecond: 0.0001,
		MaxEntries:      100,
		IdleTTL:         time.Hour,
	})
	if err != nil {
		t.Fatalf("ratelimit.New() error = %v", err)
	}
	server := NewServer(app.NewService(&recordingStore{}), limiter)

	if _, err := server.SubmitExecution(context.Background(), validSubmitExecutionRequest("tenant-1")); err != nil {
		t.Fatalf("first request: unexpected error = %v", err)
	}

	_, err = server.SubmitExecution(context.Background(), validSubmitExecutionRequest("tenant-1"))
	if status.Code(err) != codes.ResourceExhausted {
		t.Fatalf("second request: status = %v, want ResourceExhausted", status.Code(err))
	}
}

func TestSubmitExecutionRateLimitTracksDistinctTenantsSeparately(t *testing.T) {
	t.Parallel()

	limiter, err := ratelimit.New(ratelimit.Config{
		Capacity:        1,
		RefillPerSecond: 0.0001,
		MaxEntries:      100,
		IdleTTL:         time.Hour,
	})
	if err != nil {
		t.Fatalf("ratelimit.New() error = %v", err)
	}
	server := NewServer(app.NewService(&recordingStore{}), limiter)

	if _, err := server.SubmitExecution(context.Background(), validSubmitExecutionRequest("tenant-a")); err != nil {
		t.Fatalf("tenant-a first request: unexpected error = %v", err)
	}
	if _, err := server.SubmitExecution(context.Background(), validSubmitExecutionRequest("tenant-b")); err != nil {
		t.Fatalf("tenant-b first request: unexpectedly limited by tenant-a's bucket: %v", err)
	}
}

func TestSubmitExecutionEmptyTenantFairnessKeyReturnsInvalidArgumentNotResourceExhausted(t *testing.T) {
	t.Parallel()

	// Limiter.Allow always denies the empty key by design (documented,
	// intentional limiter behavior), regardless of remaining capacity. If the
	// limiter guard ran before validation, an empty tenant_fairness_key would
	// therefore always be reported as ResourceExhausted instead of the
	// permanent InvalidArgument validation failure it actually is.
	limiter, err := ratelimit.New(ratelimit.Config{
		Capacity:        1,
		RefillPerSecond: 0.0001,
		MaxEntries:      100,
		IdleTTL:         time.Hour,
	})
	if err != nil {
		t.Fatalf("ratelimit.New() error = %v", err)
	}
	server := NewServer(app.NewService(&recordingStore{}), limiter)

	_, err = server.SubmitExecution(context.Background(), validSubmitExecutionRequest(""))
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("empty tenant_fairness_key: status = %v, want InvalidArgument", status.Code(err))
	}
}

func TestSubmitExecutionNilLimiterAllowsAllRequests(t *testing.T) {
	t.Parallel()

	server := NewServer(app.NewService(&recordingStore{}), nil)
	for i := range 5 {
		if _, err := server.SubmitExecution(context.Background(), validSubmitExecutionRequest("tenant-1")); err != nil {
			t.Fatalf("request %d: unexpected error = %v (nil limiter must allow all)", i+1, err)
		}
	}
}

func TestServerDeleteExecutionJob(t *testing.T) {
	t.Parallel()

	store := &deleteAssertingStore{}
	server := NewServer(app.NewService(store), nil)

	request := &judgev1.DeleteExecutionJobRequest{
		Id:      "019b11a0-0000-7000-8000-000000000010",
		ActorId: "019b11a0-0000-7000-8000-000000000011",
		Reason:  "duplicate submission",
	}

	if _, err := server.DeleteExecutionJob(context.Background(), request); err != nil {
		t.Fatalf("DeleteExecutionJob() unexpected error = %v", err)
	}

	if len(store.softDeleteCalls) != 1 {
		t.Fatalf("SoftDeleteExecutionJob call count = %d, want 1", len(store.softDeleteCalls))
	}
	want := app.DeleteExecutionJob{ID: request.GetId(), ActorID: request.GetActorId(), Reason: request.GetReason()}
	if store.softDeleteCalls[0] != want {
		t.Fatalf("SoftDeleteExecutionJob command = %+v, want %+v", store.softDeleteCalls[0], want)
	}
	if len(store.hardDeleteCalls) != 0 {
		t.Fatalf("HardDeleteExecutionJob call count = %d, want 0 (DeleteExecutionJob must only soft-delete)", len(store.hardDeleteCalls))
	}

	store.softDeleteErr = app.ErrIdempotencyConflict
	if _, err := server.DeleteExecutionJob(context.Background(), request); status.Code(err) != codes.AlreadyExists {
		t.Fatalf("status = %v, want AlreadyExists", status.Code(err))
	}

	if _, err := server.DeleteExecutionJob(context.Background(), nil); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("nil request: status = %v, want InvalidArgument", status.Code(err))
	}
}

func TestServerHardDeleteExecutionJob(t *testing.T) {
	t.Parallel()

	store := &deleteAssertingStore{}
	server := NewServer(app.NewService(store), nil)

	request := &judgev1.HardDeleteExecutionJobRequest{
		Id:      "019b11a0-0000-7000-8000-000000000012",
		ActorId: "019b11a0-0000-7000-8000-000000000013",
		Reason:  "SuperAdmin purge",
	}

	if _, err := server.HardDeleteExecutionJob(context.Background(), request); err != nil {
		t.Fatalf("HardDeleteExecutionJob() unexpected error = %v", err)
	}

	if len(store.hardDeleteCalls) != 1 {
		t.Fatalf("HardDeleteExecutionJob call count = %d, want 1", len(store.hardDeleteCalls))
	}
	want := app.DeleteExecutionJob{ID: request.GetId(), ActorID: request.GetActorId(), Reason: request.GetReason()}
	if store.hardDeleteCalls[0] != want {
		t.Fatalf("HardDeleteExecutionJob command = %+v, want %+v", store.hardDeleteCalls[0], want)
	}
	if len(store.softDeleteCalls) != 0 {
		t.Fatalf("SoftDeleteExecutionJob call count = %d, want 0 (HardDeleteExecutionJob must not soft-delete)", len(store.softDeleteCalls))
	}

	store.hardDeleteErr = errors.New("store failure")
	if _, err := server.HardDeleteExecutionJob(context.Background(), request); status.Code(err) != codes.Internal {
		t.Fatalf("status = %v, want Internal", status.Code(err))
	}

	if _, err := server.HardDeleteExecutionJob(context.Background(), nil); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("nil request: status = %v, want InvalidArgument", status.Code(err))
	}
}

func TestToStatusErrorMapping(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		err      error
		wantCode codes.Code
	}{
		{
			name:     "fan-out unavailable maps to FailedPrecondition, not Internal",
			err:      app.ErrFanOutUnavailable,
			wantCode: codes.FailedPrecondition,
		},
		{
			name:     "completion not leased maps to FailedPrecondition",
			err:      app.ErrCompletionNotLeased,
			wantCode: codes.FailedPrecondition,
		},
		{
			name:     "unmapped error falls back to Internal",
			err:      errors.New("unmapped store failure"),
			wantCode: codes.Internal,
		},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			got := toStatusError(testCase.err)
			if status.Code(got) != testCase.wantCode {
				t.Fatalf("toStatusError(%v) code = %v, want %v", testCase.err, status.Code(got), testCase.wantCode)
			}
			if testCase.wantCode != codes.Internal && got.Error() != status.Error(testCase.wantCode, testCase.err.Error()).Error() {
				t.Fatalf("toStatusError(%v) = %v, want the underlying message preserved", testCase.err, got)
			}
		})
	}
}
