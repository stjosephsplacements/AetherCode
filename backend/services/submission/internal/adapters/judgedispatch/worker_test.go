package judgedispatch

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	judgev1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/judge/v1"
)

type recordingStore struct {
	claims     []Claim
	claimErr   error
	dispatched map[string]string
	failed     map[string]string
	markErr    error
}

func (store *recordingStore) Claim(context.Context, uint32, uint32) ([]Claim, error) {
	return store.claims, store.claimErr
}

func (store *recordingStore) MarkDispatched(_ context.Context, claim Claim, jobID string) error {
	if store.markErr != nil {
		return store.markErr
	}
	if store.dispatched == nil {
		store.dispatched = map[string]string{}
	}
	store.dispatched[claim.EvaluationRequestID] = jobID
	return nil
}

func (store *recordingStore) MarkFailed(_ context.Context, claim Claim, code string) error {
	if store.failed == nil {
		store.failed = map[string]string{}
	}
	store.failed[claim.EvaluationRequestID] = code
	return nil
}

func (store *recordingStore) Ping(context.Context) error { return nil }

type scriptedClient struct {
	jobID     string
	err       error
	submitted []*judgev1.SubmitExecutionRequest
}

func (client *scriptedClient) Submit(_ context.Context, request *judgev1.SubmitExecutionRequest) (string, error) {
	client.submitted = append(client.submitted, request)
	return client.jobID, client.err
}

func testRuntime() Runtime {
	return Runtime{Enabled: true, BatchSize: 10, LeaseSeconds: 30, PollInterval: time.Second}
}

func newTestWorker(t *testing.T, client Client, store DispatchStore) *Worker {
	t.Helper()
	worker, err := NewWorker(client, store, testRuntime(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("NewWorker() error = %v", err)
	}
	return worker
}

func TestWorkerRecordsTheJobJudgeAccepted(t *testing.T) {
	t.Parallel()
	claim := validClaim()
	store := &recordingStore{claims: []Claim{claim}}
	client := &scriptedClient{jobID: "019c06d6-20e1-7a21-8a4f-bd8b21a43f20"}
	worker := newTestWorker(t, client, store)
	if err := worker.ProcessOnce(context.Background()); err != nil {
		t.Fatalf("ProcessOnce() error = %v", err)
	}
	if store.dispatched[claim.EvaluationRequestID] != client.jobID || len(store.failed) != 0 {
		t.Fatalf("dispatched = %v, failed = %v", store.dispatched, store.failed)
	}
	if err := worker.Ready(context.Background()); err != nil {
		t.Fatalf("Ready() error = %v", err)
	}
}

func TestWorkerLeavesTransientFailuresToTheLease(t *testing.T) {
	t.Parallel()
	store := &recordingStore{claims: []Claim{validClaim()}}
	client := &scriptedClient{err: errors.New("judge unavailable")}
	if err := newTestWorker(t, client, store).ProcessOnce(context.Background()); err != nil {
		t.Fatalf("ProcessOnce() error = %v", err)
	}
	if len(store.dispatched) != 0 || len(store.failed) != 0 {
		t.Fatalf("a transient failure changed state: dispatched = %v, failed = %v", store.dispatched, store.failed)
	}
}

func TestWorkerLeavesMarkFailuresToTheLease(t *testing.T) {
	t.Parallel()
	store := &recordingStore{claims: []Claim{validClaim()}, markErr: errors.New("database unavailable")}
	client := &scriptedClient{jobID: "019c06d6-20e1-7a21-8a4f-bd8b21a43f20"}
	if err := newTestWorker(t, client, store).ProcessOnce(context.Background()); err != nil {
		t.Fatalf("ProcessOnce() error = %v", err)
	}
	if len(client.submitted) != 1 || len(store.failed) != 0 {
		t.Fatalf("submitted = %d, failed = %v", len(client.submitted), store.failed)
	}
}

func TestWorkerFailsRequestsThatCanNeverBeGraded(t *testing.T) {
	t.Parallel()
	legacy := validClaim()
	legacy.EvaluationRequestID = "019c06d6-20e1-7a21-8a4f-bd8b21a43f21"
	legacy.TimeLimitMS = nil
	rejected := validClaim()
	store := &recordingStore{claims: []Claim{legacy, rejected}}
	client := &scriptedClient{err: &PermanentError{Err: errors.New("invalid argument")}}
	if err := newTestWorker(t, client, store).ProcessOnce(context.Background()); err != nil {
		t.Fatalf("ProcessOnce() error = %v", err)
	}
	if store.failed[legacy.EvaluationRequestID] != failureNotExecutable || store.failed[rejected.EvaluationRequestID] != failureJudgeRejected {
		t.Fatalf("failed = %v", store.failed)
	}
	if len(client.submitted) != 1 {
		t.Fatalf("a request without limits must not reach Judge; submitted = %d", len(client.submitted))
	}
}

func TestWorkerReportsAFailedClaimAndStaysNotReady(t *testing.T) {
	t.Parallel()
	store := &recordingStore{claimErr: errors.New("database unavailable")}
	worker := newTestWorker(t, &scriptedClient{}, store)
	if err := worker.ProcessOnce(context.Background()); err == nil {
		t.Fatal("ProcessOnce() hid a failed claim")
	}
	if err := worker.Ready(context.Background()); err == nil {
		t.Fatal("Ready() succeeded before any claim cycle completed")
	}
}
