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
	// RunForJob reports whether a Judge job is a candidate's run (ADR-0021).
	RunForJob(context.Context, string) (RunTarget, bool, error)
	PersistRun(context.Context, RunCompletion) error
	Ping(context.Context) error
}

// Worker bridges one private wrapper pull stream into Submission's durable
// local outbox. It acknowledges only after Persist's transaction commits.
type Worker struct {
	client   Client
	store    CompletionStore
	outputs  OutputReader
	runtime  Runtime
	logger   *slog.Logger
	mu       sync.RWMutex
	lastGood time.Time
}

func NewWorker(client Client, store CompletionStore, outputs OutputReader, runtime Runtime, logger *slog.Logger) (*Worker, error) {
	if client == nil || store == nil || outputs == nil || logger == nil || !runtime.Enabled {
		return nil, fmt.Errorf("enabled Judge completion client, store, output reader, runtime, and logger are required")
	}
	return &Worker{client: client, store: store, outputs: outputs, runtime: runtime, logger: logger}, nil
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
		if err := worker.persist(contextValue, completion); err != nil {
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

// persist records a run's completion with its output, or a graded
// completion through the ingress. A run whose dispatch has not been recorded
// yet looks like an unknown grading job; the ingress refuses it and the lease
// is replayed once the run carries the job id.
func (worker *Worker) persist(contextValue context.Context, completion Completion) error {
	target, isRun, err := worker.store.RunForJob(contextValue, completion.JudgeJobID)
	if err != nil {
		return err
	}
	if !isRun {
		return worker.store.Persist(contextValue, worker.runtime.ConsumerID, completion)
	}
	run, err := runCompletion(contextValue, worker.outputs, target, completion)
	if err != nil {
		return err
	}
	return worker.store.PersistRun(contextValue, run)
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
