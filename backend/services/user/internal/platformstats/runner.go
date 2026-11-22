package platformstats

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

type Runner struct {
	store    *Store
	runtime  Runtime
	logger   *slog.Logger
	mu       sync.RWMutex
	lastGood time.Time
	lastLink time.Time
}

func NewRunner(store *Store, runtime Runtime, logger *slog.Logger) (*Runner, error) {
	if store == nil || logger == nil || !runtime.Enabled {
		return nil, fmt.Errorf("enabled platform-stats store, runtime, and logger are required")
	}
	return &Runner{store: store, runtime: runtime, logger: logger}, nil
}

func (runner *Runner) ProcessOnce(ctx context.Context) error {
	if time.Since(runner.lastLink) >= runner.runtime.LinkSyncEvery {
		tenants, err := runner.store.ListTenants(ctx)
		if err != nil {
			return err
		}
		for _, tenantID := range tenants {
			if err := runner.store.SyncLinks(ctx, tenantID); err != nil {
				runner.logger.Warn("sync profile links", "tenant_id", tenantID, "error", err)
			}
		}
		runner.lastLink = time.Now().UTC()
	}
	items, err := runner.store.Claim(ctx, runner.runtime.BatchSize)
	if err != nil {
		return err
	}
	for _, item := range items {
		result := Fetch(ctx, item.Platform, item.Handle)
		status := result.Status
		failure := failureText(result.Err)
		if result.Err != nil && status == "" {
			status = staleOnRateLimit(result.Err)
		}
		if status == "" {
			status = "fresh"
		}
		if err := runner.store.Save(ctx, item, result.Lines, status, failure); err != nil {
			return err
		}
		if result.Err != nil && status == "stale" {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoffSeconds(item.Platform, 1)):
			}
		}
	}
	runner.mu.Lock()
	runner.lastGood = time.Now().UTC()
	runner.mu.Unlock()
	return nil
}

func (runner *Runner) Run(ctx context.Context) {
	ticker := time.NewTicker(runner.runtime.PollInterval)
	defer ticker.Stop()
	for {
		if err := runner.ProcessOnce(ctx); err != nil && ctx.Err() == nil {
			runner.logger.Error("refresh platform stats", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (runner *Runner) Ready(ctx context.Context) error {
	if runner == nil || runner.store == nil {
		return fmt.Errorf("platform stats runner is not initialized")
	}
	if err := runner.store.Ping(ctx); err != nil {
		return err
	}
	runner.mu.RLock()
	lastGood := runner.lastGood
	runner.mu.RUnlock()
	if lastGood.IsZero() {
		return nil
	}
	if time.Since(lastGood) > runner.runtime.ReadyWindow() {
		return fmt.Errorf("platform stats worker has not completed a recent refresh")
	}
	return nil
}
