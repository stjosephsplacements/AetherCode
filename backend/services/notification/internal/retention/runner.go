package retention

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

// Purger is deliberately small so retention scheduling can be tested without
// request-serving credentials or a live database.
type Purger interface {
	Ping(context.Context) error
	Purge(context.Context, int) (Result, error)
}

// Runner executes bounded purge batches. Each database invocation has its own
// transaction, so a worker failure can leave only uncommitted work for a later
// replica and never bypass the legal-hold checks.
type Runner struct {
	store    Purger
	runtime  Runtime
	logger   *slog.Logger
	mu       sync.RWMutex
	lastGood time.Time
}

func NewRunner(store Purger, runtime Runtime, logger *slog.Logger) (*Runner, error) {
	if store == nil || logger == nil || !runtime.Enabled {
		return nil, fmt.Errorf("enabled notification retention store, runtime, and logger are required")
	}
	return &Runner{store: store, runtime: runtime, logger: logger}, nil
}

func (runner *Runner) ProcessOnce(contextValue context.Context) error {
	if runner == nil || runner.store == nil {
		return fmt.Errorf("notification retention runner is not initialized")
	}
	for batch := 0; batch < runner.runtime.MaxBatches; batch++ {
		result, err := runner.store.Purge(contextValue, runner.runtime.BatchSize)
		if err != nil {
			return err
		}
		if result.Total() < int64(runner.runtime.BatchSize) {
			break
		}
	}
	runner.mu.Lock()
	runner.lastGood = time.Now().UTC()
	runner.mu.Unlock()
	return nil
}

func (runner *Runner) Run(contextValue context.Context) {
	if runner == nil {
		return
	}
	ticker := time.NewTicker(runner.runtime.PollInterval)
	defer ticker.Stop()
	for {
		if err := runner.ProcessOnce(contextValue); err != nil && contextValue.Err() == nil {
			runner.logger.Error("purge expired notification retention data", "error", err)
		}
		select {
		case <-contextValue.Done():
			return
		case <-ticker.C:
		}
	}
}

func (runner *Runner) Ready(contextValue context.Context) error {
	if runner == nil || runner.store == nil {
		return fmt.Errorf("notification retention runner is not initialized")
	}
	if err := runner.store.Ping(contextValue); err != nil {
		return err
	}
	runner.mu.RLock()
	lastGood := runner.lastGood
	runner.mu.RUnlock()
	if lastGood.IsZero() || time.Since(lastGood) > runner.runtime.ReadyWindow() {
		return fmt.Errorf("notification retention worker has not completed a recent purge")
	}
	return nil
}
