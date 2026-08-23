package grpcadapter

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/ratelimit"
	judgev1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/judge/v1"
	"github.com/aethercode/aethercode/services/judge/internal/app"
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
