// Package worker runs bounded internal notification delivery work. It keeps
// delivery state in PostgreSQL, so a process failure merely leaves due rows
// eligible for a later replica rather than losing accepted notifications.
package worker

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"
)

type DeliveryService interface {
	DeliverDueInApp(context.Context, int) (int, error)
}

type InAppRunner struct {
	service DeliveryService
	logger  *slog.Logger
	period  time.Duration
	limit   int
	failure atomic.Value
}

func NewInAppRunner(service DeliveryService, logger *slog.Logger) (*InAppRunner, error) {
	if service == nil || logger == nil {
		return nil, fmt.Errorf("notification delivery service and logger are required")
	}
	runner := &InAppRunner{service: service, logger: logger, period: time.Second, limit: 100}
	runner.failure.Store("")
	return runner, nil
}

func (runner *InAppRunner) Run(ctx context.Context) {
	if runner == nil {
		return
	}
	runner.deliver(ctx)
	ticker := time.NewTicker(runner.period)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runner.deliver(ctx)
		}
	}
}

func (runner *InAppRunner) Ready(context.Context) error {
	if runner == nil || runner.service == nil {
		return fmt.Errorf("notification delivery runner is not initialized")
	}
	if failure, found := runner.failure.Load().(string); found && strings.TrimSpace(failure) != "" {
		return fmt.Errorf("notification delivery runner retrying: %s", failure)
	}
	return nil
}

func (runner *InAppRunner) deliver(ctx context.Context) {
	for {
		count, err := runner.service.DeliverDueInApp(ctx, runner.limit)
		if err != nil {
			runner.failure.Store(err.Error())
			runner.logger.Error("deliver due in-app notifications", "error", err)
			return
		}
		runner.failure.Store("")
		if count < runner.limit {
			return
		}
	}
}
