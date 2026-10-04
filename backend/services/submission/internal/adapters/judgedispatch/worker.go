package judgedispatch

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

// DispatchStore is deliberately smaller than the PostgreSQL adapter so the
// claim/submit/mark sequence can be unit tested without Judge or a database.
type DispatchStore interface {
	Claim(context.Context, uint32, uint32) ([]Claim, error)
	MarkDispatched(context.Context, Claim, string) error
	MarkFailed(context.Context, Claim, string) error
	Ping(context.Context) error
}

// Worker moves queued evaluation requests into Judge. Retries need no loop of
// their own: a request whose submission failed keeps its lease, and the claim
// routine hands it out again when the lease (doubling per attempt, capped at
// five minutes) lapses.
type Worker struct {
	client   Client
	store    DispatchStore
	runtime  Runtime
	logger   *slog.Logger
	mu       sync.RWMutex
	lastGood time.Time
}

func NewWorker(client Client, store DispatchStore, runtime Runtime, logger *slog.Logger) (*Worker, error) {
	if client == nil || store == nil || logger == nil || !runtime.Enabled {
		return nil, fmt.Errorf("enabled Judge dispatch client, store, runtime, and logger are required")
	}
	return &Worker{client: client, store: store, runtime: runtime, logger: logger}, nil
}

// ProcessOnce claims one batch and dispatches it. Only a failed claim is an
// error: a single request's trouble must not hold up the rest of the batch, so
// it is logged and left to its lease.
func (worker *Worker) ProcessOnce(contextValue context.Context) error {
	claims, err := worker.store.Claim(contextValue, worker.runtime.BatchSize, worker.runtime.LeaseSeconds)
	if err != nil {
		return err
	}
	for _, claim := range claims {
		if err := worker.dispatch(contextValue, claim); err != nil {
			worker.logger.Error("Judge dispatch will retry", "evaluation_request_id", claim.EvaluationRequestID, "error", err)
		}
	}
	worker.mu.Lock()
	worker.lastGood = time.Now().UTC()
	worker.mu.Unlock()
	return nil
}

func (worker *Worker) dispatch(contextValue context.Context, claim Claim) error {
	request, err := buildRequest(claim)
	if errors.Is(err, errNotExecutable) {
		worker.logger.Error("evaluation request cannot be graded", "evaluation_request_id", claim.EvaluationRequestID, "error", err)
		return worker.store.MarkFailed(contextValue, claim, failureNotExecutable)
	}
	if err != nil {
		return err
	}
	jobID, err := worker.client.Submit(contextValue, request)
	var permanent *PermanentError
	if errors.As(err, &permanent) {
		worker.logger.Error("Judge rejected an evaluation request", "evaluation_request_id", claim.EvaluationRequestID, "error", err)
		return worker.store.MarkFailed(contextValue, claim, failureJudgeRejected)
	}
	if err != nil {
		return err
	}
	return worker.store.MarkDispatched(contextValue, claim, jobID)
}

func (worker *Worker) Run(contextValue context.Context) {
	ticker := time.NewTicker(worker.runtime.PollInterval)
	defer ticker.Stop()
	for {
		if err := worker.ProcessOnce(contextValue); err != nil && contextValue.Err() == nil {
			worker.logger.Error("Judge dispatch claim failed", "error", err)
		}
		select {
		case <-contextValue.Done():
			return
		case <-ticker.C:
		}
	}
}

// Ready fails closed when no claim cycle has completed recently: queued
// evaluation requests would otherwise wait unnoticed.
func (worker *Worker) Ready(contextValue context.Context) error {
	if worker == nil {
		return fmt.Errorf("judge dispatch worker is not initialized")
	}
	if err := worker.store.Ping(contextValue); err != nil {
		return err
	}
	worker.mu.RLock()
	lastGood := worker.lastGood
	worker.mu.RUnlock()
	if lastGood.IsZero() || time.Since(lastGood) > worker.runtime.ReadyWindow() {
		return fmt.Errorf("judge dispatch has not completed a recent claim cycle")
	}
	return nil
}
