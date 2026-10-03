package judgecompletion

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

// CompletionStore is deliberately smaller than the PostgreSQL adapter so the
// lease/ack sequence can be unit tested without a Judge or object store.
type CompletionStore interface {
	Persist(context.Context, string, Completion) error
	Ping(context.Context) error
}

// Worker bridges one private wrapper pull stream into Submission's durable
// local outbox. It acknowledges only after Persist's transaction commits.
type Worker struct {
	client   Client
	store    CompletionStore
	runtime  Runtime
	logger   *slog.Logger
	mu       sync.RWMutex
	lastGood time.Time
}

func NewWorker(client Client, store CompletionStore, runtime Runtime, logger *slog.Logger) (*Worker, error) {
	if client == nil || store == nil || logger == nil || !runtime.Enabled {
		return nil, fmt.Errorf("enabled Judge completion client, store, runtime, and logger are required")
	}
	return &Worker{client: client, store: store, runtime: runtime, logger: logger}, nil
}

// ProcessOnce performs one bounded pull. A persistence or acknowledgement
// failure leaves the exact remote lease unacknowledged for safe replay.
func (worker *Worker) ProcessOnce(contextValue context.Context) error {
	completions, err := worker.client.Pull(
		contextValue, worker.runtime.ConsumerID, worker.runtime.BatchSize, worker.runtime.LeaseSeconds,
	)
	if err != nil {
		return err
	}
	for _, completion := range completions {
		if err := completion.Validate(); err != nil {
			return err
		}
		if err := worker.store.Persist(contextValue, worker.runtime.ConsumerID, completion); err != nil {
			return err
		}
		if err := worker.client.Acknowledge(contextValue, worker.runtime.ConsumerID, completion); err != nil {
			return err
		}
	}
	worker.mu.Lock()
	worker.lastGood = time.Now().UTC()
	worker.mu.Unlock()
	return nil
}

func (worker *Worker) Run(contextValue context.Context) {
	ticker := time.NewTicker(worker.runtime.PollInterval)
	defer ticker.Stop()
	for {
		if err := worker.ProcessOnce(contextValue); err != nil && contextValue.Err() == nil {
			worker.logger.Error("Judge completion bridge retrying", "error", err)
		}
		select {
		case <-contextValue.Done():
			return
		case <-ticker.C:
		}
	}
}

// Ready is intentionally stricter than a live TCP socket: a successful full
// pull/ack cycle must have happened recently, otherwise pending completions
// could be stranded and this service fails readiness closed.
func (worker *Worker) Ready(contextValue context.Context) error {
	if worker == nil {
		return fmt.Errorf("judge completion worker is not initialized")
	}
	if err := worker.store.Ping(contextValue); err != nil {
		return err
	}
	worker.mu.RLock()
	lastGood := worker.lastGood
	worker.mu.RUnlock()
	if lastGood.IsZero() || time.Since(lastGood) > worker.runtime.ReadyWindow() {
		return fmt.Errorf("judge completion bridge has not completed a recent pull")
	}
	return nil
}
