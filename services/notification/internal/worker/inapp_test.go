package worker

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
)

type deliveryStub struct{ err error }

func (stub deliveryStub) DeliverDueInApp(context.Context, int) (int, error) {
	return 0, stub.err
}

func TestInAppRunnerReadinessReportsDeliveryFailure(t *testing.T) {
	t.Parallel()
	runner, err := NewInAppRunner(deliveryStub{err: errors.New("database unavailable")}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("NewInAppRunner() error = %v", err)
	}
	runner.deliver(context.Background())
	if err := runner.Ready(context.Background()); err == nil {
		t.Fatal("Ready() did not report the delivery failure")
	}
}
