package dispatcher

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/stjosephsplacements/AetherCode/libs/pkg/evalbundle"
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

	batched := w.submitBatches(ctx, job)
	if engine, ok := w.engine.(BatchEngine); ok {
		// Release any batch verdict that was never polled (an error ended the job early).
		defer func() {
			for _, token := range batched {
				engine.Forget(token)
			}
		}()
	}
	compileFailed := false
	for _, unit := range job.Units {
		var output *evalbundle.UnitOutput
		if job.ReturnsOutput {
			output = &evalbundle.UnitOutput{Stdin: unit.Stdin, ExpectedOutput: unit.ExpectedOutput}
		}
		// Every unit runs the same source, so once it fails to compile the
		// remaining units cannot behave differently; record them without
		// spending engine time.
		if compileFailed {
			if token, ok := batched[unit.ID]; ok {
				w.engine.(BatchEngine).Forget(token)
			}
			if err := w.store.RecordVerdict(ctx, unit.ID, UnitVerdict{Status: "compile_error"}, output); err != nil {
				return fmt.Errorf("record verdict for unit %s: %w", unit.ID, err)
			}
			continue
		}
		token := unit.Token
		if token == "" {
			token = batched[unit.ID]
		}
		if token == "" {
			submitted, submitErr := w.engine.Submit(ctx, UnitRequest{
				Language:       unit.Language,
				SourceCode:     unit.SourceCode,
				Stdin:          unit.Stdin,
				TimeLimitMS:    unit.TimeLimitMS,
				MemLimitKB:     unit.MemLimitKB,
				ExpectedOutput: unit.ExpectedOutput,
				IdempotencyKey: unit.ID,
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
		if output != nil {
			output.Stdout, output.Stderr, output.CompileOutput = verdict.Stdout, verdict.Stderr, verdict.CompileOutput
		}
		if err := w.store.RecordVerdict(ctx, unit.ID, *verdict, output); err != nil {
			return fmt.Errorf("record verdict for unit %s: %w", unit.ID, err)
		}
		compileFailed = verdict.Status == "compile_error"
	}

	if err := w.store.MarkJobComplete(ctx, job.ID); err != nil {
		return fmt.Errorf("mark job %s complete: %w", job.ID, err)
	}
	return nil
}

// submitBatches sends a job's pending units to a BatchEngine in as few engine
// jobs as possible and returns the token of each unit it submitted, by unit id.
// The engine then compiles the program once and runs the tests side by side
// instead of one engine job per test. It does nothing, and the units go one by
// one as before, when the engine has no batch support, when fewer than two
// units are pending, or when a batch fails (the error is logged and the units
// that did not get a token are submitted individually).
func (w *Worker) submitBatches(ctx context.Context, job *DispatchJob) map[string]string {
	engine, ok := w.engine.(BatchEngine)
	if !ok {
		return nil
	}
	var pending []DispatchUnit
	for _, unit := range job.Units {
		if unit.Token == "" {
			pending = append(pending, unit)
		}
	}
	if len(pending) < 2 || !sameProgram(pending) {
		return nil
	}
	tokens := make(map[string]string, len(pending))
	for start := 0; start < len(pending); start += MaxBatchUnits {
		chunk := pending[start:min(start+MaxBatchUnits, len(pending))]
		requests := make([]UnitRequest, len(chunk))
		for i, unit := range chunk {
			requests[i] = UnitRequest{
				Language:       unit.Language,
				SourceCode:     unit.SourceCode,
				Stdin:          unit.Stdin,
				TimeLimitMS:    unit.TimeLimitMS,
				MemLimitKB:     unit.MemLimitKB,
				ExpectedOutput: unit.ExpectedOutput,
				IdempotencyKey: unit.ID,
			}
		}
		submitted, err := engine.SubmitBatch(ctx, requests)
		if err != nil || len(submitted) != len(chunk) {
			w.logger.Warn("dispatch: batch submit failed; submitting the units one by one", "job_id", job.ID, "units", len(chunk), "err", err)
			continue
		}
		for i, unit := range chunk {
			if err := w.store.RecordToken(ctx, unit.ID, submitted[i]); err != nil {
				w.logger.Warn("dispatch: could not record a batch token", "unit_id", unit.ID, "err", err)
				engine.Forget(submitted[i])
				continue
			}
			tokens[unit.ID] = submitted[i]
		}
	}
	return tokens
}

// sameProgram reports whether every unit runs the same source in the same
// language under the same limits, which is what one engine job requires.
func sameProgram(units []DispatchUnit) bool {
	first := units[0]
	for _, unit := range units[1:] {
		if unit.Language != first.Language || unit.SourceCode != first.SourceCode || unit.TimeLimitMS != first.TimeLimitMS || unit.MemLimitKB != first.MemLimitKB {
			return false
		}
	}
	return true
}

// pollUntilDone polls the engine until it returns a non-nil terminal verdict
// or MaxPollAttempts is exhausted. On exhaustion, it returns a synthetic
// internal_error verdict so the job transitions to a terminal state rather
// than stalling indefinitely. internal_error (not time_limit_exceeded) is
// used deliberately: poll exhaustion means the engine never reported a
// terminal state at all, which is an engine/infrastructure failure (e.g. an
// engine outage), not evidence that the candidate's code ran too long — a
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
