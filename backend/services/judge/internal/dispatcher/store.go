package dispatcher

import "context"

// Store is the persistence port used by the dispatcher worker. It is
// intentionally narrower than the control-plane app.Store to keep the
// dispatcher layer free of control-plane concerns.
type Store interface {
	// FetchQueuedJob returns the job and its non-terminal units. A nil return
	// with no error means the job was not found or has already reached a
	// terminal state; the caller should treat this as a successful no-op.
	FetchQueuedJob(ctx context.Context, jobID string) (*DispatchJob, error)
	// RecordToken persists the engine submission token for one test unit so
	// that a crash between Submit and Poll can be recovered without re-submitting.
	RecordToken(ctx context.Context, unitID, token string) error
	// RecordVerdict persists the terminal engine verdict for one test unit.
	RecordVerdict(ctx context.Context, unitID string, verdict UnitVerdict) error
	// MarkJobComplete transitions the job to a terminal state with the
	// provided overall verdict status.
	MarkJobComplete(ctx context.Context, jobID, overallStatus string) error
	// FetchIncompleteTokens returns units that have been submitted to the
	// engine but have not yet received a verdict. Used for crash recovery.
	FetchIncompleteTokens(ctx context.Context) ([]PendingUnit, error)
}

// DispatchJob is a queued execution job with its pending test units.
type DispatchJob struct {
	ID    string
	Units []DispatchUnit
}

// DispatchUnit is one test case within a queued job.
type DispatchUnit struct {
	ID             string
	SourceCode     string
	Language       string
	Stdin          string
	TimeLimitMS    int
	MemLimitKB     int
	ExpectedOutput string
	// Token is non-empty when the unit was already submitted to the engine
	// before a worker crash, allowing the worker to skip re-submission and
	// resume polling instead.
	Token string
}

// PendingUnit identifies an engine-submitted unit that has not yet received a
// verdict. Returned by FetchIncompleteTokens for crash-recovery polling.
type PendingUnit struct {
	ID    string
	JobID string
	Token string
}

// UnitResult is one unit's terminal outcome, read back after a job completes.
type UnitResult struct {
	UnitNumber int
	Verdict    string
	TimeMS     *int
	MemoryKB   *int
}
