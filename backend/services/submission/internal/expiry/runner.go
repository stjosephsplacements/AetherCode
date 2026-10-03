package expiry

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

// Expirer is deliberately small so expiry scheduling can be tested without
// request-serving credentials or a live database.
type Expirer interface {
	Ping(context.Context) error
	ExpireOverdue(context.Context, int) (int, error)
}

// Runner executes bounded expiry batches. Each database invocation has its own
// transaction, so a worker failure can leave only uncommitted work for a later
// replica and never corrupts partial state.
type Runner struct {
	store    Expirer
	runtime  Runtime
	logger   *slog.Logger
	mu       sync.RWMutex
	lastGood time.Time
}

func NewRunner(store Expirer, runtime Runtime, logger *slog.Logger) (*Runner, error) {
	if store == nil || logger == nil || !runtime.Enabled {
		return nil, fmt.Errorf("enabled submission expiry store, runtime, and logger are required")
	}
	return &Runner{store: store, runtime: runtime, logger: logger}, nil
}

func (runner *Runner) ProcessOnce(contextValue context.Context) error {
	if runner == nil || runner.store == nil {
		return fmt.Errorf("submission expiry runner is not initialized")
	}
	for batch := 0; batch < runner.runtime.MaxBatches; batch++ {
		expired, err := runner.store.ExpireOverdue(contextValue, runner.runtime.BatchSize)
		if err != nil {
			return err
		}
		if expired < runner.runtime.BatchSize {
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
			runner.logger.Error("expire overdue submission attempts", "error", err)
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
		return fmt.Errorf("submission expiry runner is not initialized")
	}
	if err := runner.store.Ping(contextValue); err != nil {
		return err
	}
	runner.mu.RLock()
	lastGood := runner.lastGood
	runner.mu.RUnlock()
	if lastGood.IsZero() || time.Since(lastGood) > runner.runtime.ReadyWindow() {
		return fmt.Errorf("submission expiry worker has not completed a recent expiry cycle")
	}
	return nil
}
