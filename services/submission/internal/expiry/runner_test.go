package expiry

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"
)

type fakeStore struct {
	returns []int
	calls   []int
	err     error
}

func (store *fakeStore) Ping(context.Context) error { return nil }

func (store *fakeStore) ExpireOverdue(_ context.Context, limit int) (int, error) {
	store.calls = append(store.calls, limit)
	if store.err != nil {
		return 0, store.err
	}
	if len(store.returns) == 0 {
		return 0, nil
	}
	next := store.returns[0]
	store.returns = store.returns[1:]
	return next, nil
}

func testRuntime() Runtime {
	return Runtime{Enabled: true, BatchSize: 10, MaxBatches: 3, PollInterval: time.Minute}
}

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestProcessOnceStopsOnShortBatch(t *testing.T) {
	t.Parallel()
	store := &fakeStore{returns: []int{10, 4}}
	runner, err := NewRunner(store, testRuntime(), discardLogger())
	if err != nil {
		t.Fatalf("NewRunner() error = %v", err)
	}
	if err := runner.ProcessOnce(context.Background()); err != nil {
		t.Fatalf("ProcessOnce() error = %v", err)
	}
	if len(store.calls) != 2 {
		t.Fatalf("batches run = %d, want 2 (a short batch must end the cycle)", len(store.calls))
	}
}

func TestProcessOnceRespectsMaxBatches(t *testing.T) {
	t.Parallel()
	store := &fakeStore{returns: []int{10, 10, 10, 10, 10}}
	runner, err := NewRunner(store, testRuntime(), discardLogger())
	if err != nil {
		t.Fatalf("NewRunner() error = %v", err)
	}
	if err := runner.ProcessOnce(context.Background()); err != nil {
		t.Fatalf("ProcessOnce() error = %v", err)
	}
	if len(store.calls) != 3 {
		t.Fatalf("batches run = %d, want 3 (MaxBatches caps one cycle)", len(store.calls))
	}
}

func TestProcessOnceReturnsStoreError(t *testing.T) {
	t.Parallel()
	store := &fakeStore{err: errors.New("database unavailable")}
	runner, err := NewRunner(store, testRuntime(), discardLogger())
	if err != nil {
		t.Fatalf("NewRunner() error = %v", err)
	}
	if err := runner.ProcessOnce(context.Background()); err == nil {
		t.Fatal("ProcessOnce() error = nil, want the store error surfaced")
	}
}

func TestNewRunnerRejectsDisabledRuntime(t *testing.T) {
	t.Parallel()
	runtime := testRuntime()
	runtime.Enabled = false
	if _, err := NewRunner(&fakeStore{}, runtime, discardLogger()); err == nil {
		t.Fatal("NewRunner() accepted a disabled runtime")
	}
}
