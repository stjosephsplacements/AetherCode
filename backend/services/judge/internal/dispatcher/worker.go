package dispatcher

import (
	"context"
	"fmt"
	"log/slog"
	"time"
)

// Worker dispatches queued execution jobs to an evaluation engine and records
// terminal verdicts. Concurrent calls to DispatchJob are safe when each call
// operates on a distinct job ID.
type Worker struct {
	store   Store
	engine  Engine
	runtime Runtime
	logger  *slog.Logger
}

// NewWorker creates a Worker. It returns an error when the dispatcher runtime
// is disabled so that callers can gate construction on the enabled flag without
// a separate condition check.
func NewWorker(store Store, engine Engine, runtime Runtime, logger *slog.Logger) (*Worker, error) {
	if !runtime.Enabled {
		return nil, fmt.Errorf("dispatcher: runtime is disabled (JUDGE_DISPATCHER_ENABLED=false)")
	}
	if store == nil {
		return nil, fmt.Errorf("dispatcher: store is required")
	}
	if engine == nil {
		return nil, fmt.Errorf("dispatcher: engine is required")
	}
	if logger == nil {
		return nil, fmt.Errorf("dispatcher: logger is required")
	}
	return &Worker{store: store, engine: engine, runtime: runtime, logger: logger}, nil
}

// DispatchJob fetches one queued job, evaluates each pending test unit, and
// writes the terminal verdict. Returning nil with no error means the job was
// not found or was already in a terminal state; the caller should treat this
// as a successful no-op and ACK the delivery.
func (w *Worker) DispatchJob(ctx context.Context, jobID string) error {
	job, err := w.store.FetchQueuedJob(ctx, jobID)
	if err != nil {
		return fmt.Errorf("fetch job %s: %w", jobID, err)
	}
	if job == nil {
		w.logger.Debug("dispatch skipped: job not found or already terminal", "job_id", jobID)
		return nil
	}

	overallStatus := "accepted"
	for _, unit := range job.Units {
		token := unit.Token
		if token == "" {
			submitted, submitErr := w.engine.Submit(ctx, UnitRequest{
				Language:       unit.Language,
				SourceCode:     unit.SourceCode,
				Stdin:          unit.Stdin,
				TimeLimitMS:    unit.TimeLimitMS,
				MemLimitKB:     unit.MemLimitKB,
				ExpectedOutput: unit.ExpectedOutput,
			})
			if submitErr != nil {
				return fmt.Errorf("submit unit %s: %w", unit.ID, submitErr)
			}
			token = submitted
			if err := w.store.RecordToken(ctx, unit.ID, token); err != nil {
				return fmt.Errorf("record token for unit %s: %w", unit.ID, err)
			}
		}

		verdict, err := w.pollUntilDone(ctx, token)
		if err != nil {
			return fmt.Errorf("poll unit %s: %w", unit.ID, err)
		}
		if err := w.store.RecordVerdict(ctx, unit.ID, *verdict); err != nil {
			return fmt.Errorf("record verdict for unit %s: %w", unit.ID, err)
		}
		if overallStatus == "accepted" && verdict.Status != "accepted" {
			overallStatus = verdict.Status
		}
	}

	if err := w.store.MarkJobComplete(ctx, job.ID, overallStatus); err != nil {
		return fmt.Errorf("mark job %s complete: %w", job.ID, err)
	}
	return nil
}

// pollUntilDone polls the engine until it returns a non-nil terminal verdict
// or MaxPollAttempts is exhausted. On exhaustion, it returns a synthetic
// internal_error verdict so the job transitions to a terminal state rather
// than stalling indefinitely. internal_error (not time_limit_exceeded) is
// used deliberately: poll exhaustion means the engine never reported a
// terminal state at all, which is an engine/infrastructure failure (e.g. a
// Judge0 outage), not evidence that the candidate's code ran too long — a
// real TLE is reported by the engine itself as a terminal verdict.
func (w *Worker) pollUntilDone(ctx context.Context, token string) (*UnitVerdict, error) {
	for attempt := 0; attempt < w.runtime.MaxPollAttempts; attempt++ {
		verdict, err := w.engine.Poll(ctx, token)
		if err != nil {
			return nil, fmt.Errorf("poll token %s: %w", token, err)
		}
		if verdict != nil {
			return verdict, nil
		}
		if !sleepContext(ctx, time.Duration(w.runtime.PollIntervalMS)*time.Millisecond) {
			return nil, ctx.Err()
		}
	}
	return &UnitVerdict{Status: "internal_error"}, nil
}

// sleepContext sleeps for d or until ctx is cancelled. It returns false when
// the context was cancelled before the timer fired.
func sleepContext(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
