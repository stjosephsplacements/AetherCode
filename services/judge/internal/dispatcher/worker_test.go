package dispatcher

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"testing"
)

// fakeEngine records Submit calls and returns a fixed verdict on Poll.
type fakeEngine struct {
	submitCalls int
	tokens      []string
	verdict     *UnitVerdict
	submitErr   error
	pollErr     error
}

func (f *fakeEngine) Submit(_ context.Context, _ UnitRequest) (string, error) {
	if f.submitErr != nil {
		return "", f.submitErr
	}
	f.submitCalls++
	token := "fake-token"
	f.tokens = append(f.tokens, token)
	return token, nil
}

func (f *fakeEngine) Poll(_ context.Context, _ string) (*UnitVerdict, error) {
	if f.pollErr != nil {
		return nil, f.pollErr
	}
	return f.verdict, nil
}

// fakeStore is an in-memory implementation of Store for unit tests.
type fakeStore struct {
	job              *DispatchJob
	fetchErr         error
	recordedTokens   map[string]string      // unitID → token
	recordedVerdicts map[string]UnitVerdict // unitID → verdict
	completedJobs    map[string]string      // jobID → overallStatus
	recordTokenErr   error
	recordVerdictErr error
	markCompleteErr  error
}

func newFakeStore(job *DispatchJob) *fakeStore {
	return &fakeStore{
		job:              job,
		recordedTokens:   make(map[string]string),
		recordedVerdicts: make(map[string]UnitVerdict),
		completedJobs:    make(map[string]string),
	}
}

func (f *fakeStore) FetchQueuedJob(_ context.Context, _ string) (*DispatchJob, error) {
	return f.job, f.fetchErr
}

func (f *fakeStore) RecordToken(_ context.Context, unitID, token string) error {
	if f.recordTokenErr != nil {
		return f.recordTokenErr
	}
	f.recordedTokens[unitID] = token
	return nil
}

func (f *fakeStore) RecordVerdict(_ context.Context, unitID string, verdict UnitVerdict) error {
	if f.recordVerdictErr != nil {
		return f.recordVerdictErr
	}
	f.recordedVerdicts[unitID] = verdict
	return nil
}

func (f *fakeStore) MarkJobComplete(_ context.Context, jobID, overallStatus string) error {
	if f.markCompleteErr != nil {
		return f.markCompleteErr
	}
	f.completedJobs[jobID] = overallStatus
	return nil
}

func (f *fakeStore) FetchIncompleteTokens(_ context.Context) ([]PendingUnit, error) {
	return nil, nil
}

func enabledRuntime() Runtime {
	return Runtime{
		Enabled:         true,
		EngineType:      "stub",
		Concurrency:     1,
		PollIntervalMS:  0, // no delay in tests
		MaxPollAttempts: 5,
	}
}

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
}

func TestNewWorkerRejectsDisabledRuntime(t *testing.T) {
	rt := enabledRuntime()
	rt.Enabled = false
	_, err := NewWorker(newFakeStore(nil), &fakeEngine{}, rt, testLogger())
	if err == nil {
		t.Fatal("expected error for disabled runtime, got nil")
	}
}

func TestWorkerDispatchesJob(t *testing.T) {
	job := &DispatchJob{
		ID: "job-1",
		Units: []DispatchUnit{
			{ID: "unit-1", Language: "go", SourceCode: "package main", TimeLimitMS: 1000, MemLimitKB: 65536},
		},
	}
	eng := &fakeEngine{verdict: &UnitVerdict{Status: "accepted", TimeMS: 42, MemoryKB: 1024}}
	store := newFakeStore(job)
	w, err := NewWorker(store, eng, enabledRuntime(), testLogger())
	if err != nil {
		t.Fatalf("NewWorker: %v", err)
	}

	if err := w.DispatchJob(context.Background(), "job-1"); err != nil {
		t.Fatalf("DispatchJob: %v", err)
	}

	if eng.submitCalls != 1 {
		t.Errorf("expected 1 Submit call, got %d", eng.submitCalls)
	}
	if store.recordedTokens["unit-1"] == "" {
		t.Error("expected token to be recorded for unit-1")
	}
	if v, ok := store.recordedVerdicts["unit-1"]; !ok || v.Status != "accepted" {
		t.Errorf("expected accepted verdict for unit-1, got %+v (ok=%v)", v, ok)
	}
	if status, ok := store.completedJobs["job-1"]; !ok || status != "accepted" {
		t.Errorf("expected job-1 marked complete with accepted, got %q (ok=%v)", status, ok)
	}
}

func TestWorkerStoreError(t *testing.T) {
	store := newFakeStore(nil)
	store.fetchErr = errors.New("db unavailable")
	w, err := NewWorker(store, &fakeEngine{}, enabledRuntime(), testLogger())
	if err != nil {
		t.Fatalf("NewWorker: %v", err)
	}

	if err := w.DispatchJob(context.Background(), "job-x"); err == nil {
		t.Fatal("expected error from store fetch, got nil")
	}
}

func TestWorkerMissingJob(t *testing.T) {
	// FetchQueuedJob returns nil, nil → idempotent no-op.
	store := newFakeStore(nil)
	w, err := NewWorker(store, &fakeEngine{}, enabledRuntime(), testLogger())
	if err != nil {
		t.Fatalf("NewWorker: %v", err)
	}

	if err := w.DispatchJob(context.Background(), "job-gone"); err != nil {
		t.Fatalf("expected nil error for missing job, got: %v", err)
	}
	if len(store.completedJobs) != 0 {
		t.Error("expected no jobs to be marked complete")
	}
}

func TestWorkerPartiallyDispatchedJob(t *testing.T) {
	// Unit already has a Token set → Submit must not be called again.
	job := &DispatchJob{
		ID: "job-2",
		Units: []DispatchUnit{
			{
				ID:          "unit-2",
				Language:    "go",
				SourceCode:  "package main",
				TimeLimitMS: 1000,
				MemLimitKB:  65536,
				Token:       "existing-token",
			},
		},
	}
	eng := &fakeEngine{verdict: &UnitVerdict{Status: "accepted", TimeMS: 10, MemoryKB: 512}}
	store := newFakeStore(job)
	w, err := NewWorker(store, eng, enabledRuntime(), testLogger())
	if err != nil {
		t.Fatalf("NewWorker: %v", err)
	}

	if err := w.DispatchJob(context.Background(), "job-2"); err != nil {
		t.Fatalf("DispatchJob: %v", err)
	}

	if eng.submitCalls != 0 {
		t.Errorf("expected 0 Submit calls for pre-tokenised unit, got %d", eng.submitCalls)
	}
	if v, ok := store.recordedVerdicts["unit-2"]; !ok || v.Status != "accepted" {
		t.Errorf("expected accepted verdict recorded for unit-2, got %+v (ok=%v)", v, ok)
	}
	if status, ok := store.completedJobs["job-2"]; !ok || status != "accepted" {
		t.Errorf("expected job-2 marked complete with accepted, got %q (ok=%v)", status, ok)
	}
}
