package retention

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"
)

func TestRunnerDrainsBoundedFullBatches(t *testing.T) {
	store := &recordingStore{results: []Result{
		{DeletedNotifications: 5, DeletedDeliveryAttempts: 5},
		{DeletedNotifications: 1},
	}}
	runner, err := NewRunner(store, Runtime{
		Enabled: true, BatchSize: 10, MaxBatches: 3, PollInterval: time.Minute,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	if err := runner.ProcessOnce(context.Background()); err != nil {
		t.Fatalf("ProcessOnce() error = %v", err)
	}
	if store.calls != 2 {
		t.Fatalf("purge calls = %d, want 2", store.calls)
	}
	if err := runner.Ready(context.Background()); err != nil {
		t.Fatalf("Ready() error = %v", err)
	}
}

func TestRunnerDoesNotBecomeReadyAfterFailedPurge(t *testing.T) {
	store := &recordingStore{err: errors.New("database unavailable")}
	runner, err := NewRunner(store, Runtime{
		Enabled: true, BatchSize: 10, MaxBatches: 1, PollInterval: time.Minute,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	if err := runner.ProcessOnce(context.Background()); err == nil {
		t.Fatal("ProcessOnce() accepted a purge failure")
	}
	if err := runner.Ready(context.Background()); err == nil {
		t.Fatal("Ready() succeeded before any retention purge")
	}
}

func TestLoadRuntimeRequiresRetentionOutsideDevelopment(t *testing.T) {
	t.Setenv("NOTIFICATION_RETENTION_ENABLED", "false")
	if _, err := LoadRuntime("production"); err == nil {
		t.Fatal("LoadRuntime() allowed retention to be disabled in production")
	}
	if runtime, err := LoadRuntime("development"); err != nil || runtime.Enabled {
		t.Fatalf("development disabled runtime = %#v, %v", runtime, err)
	}
}

type recordingStore struct {
	results []Result
	err     error
	calls   int
}

func (store *recordingStore) Ping(context.Context) error { return store.err }

func (store *recordingStore) Purge(context.Context, int) (Result, error) {
	store.calls++
	if store.err != nil {
		return Result{}, store.err
	}
	if len(store.results) == 0 {
		return Result{}, nil
	}
	result := store.results[0]
	store.results = store.results[1:]
	return result, nil
}
