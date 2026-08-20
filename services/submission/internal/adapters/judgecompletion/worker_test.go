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
