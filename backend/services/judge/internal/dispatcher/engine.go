// Package dispatcher coordinates execution job dispatch and verdict collection.
package dispatcher

import "context"

// Engine is the evaluation engine port. The stub is used by default; the
// AetherCode Execution Engine adapter (JUDGE_ENGINE=aethercode) requires the
// engine compatibility gate.
type Engine interface {
	Submit(ctx context.Context, req UnitRequest) (token string, err error)
	Poll(ctx context.Context, token string) (*UnitVerdict, error)
}

// BatchEngine is an Engine that can run several units of one program in a
// single job: one queue entry, one compile, the tests running side by side.
// Every request in a batch has the same language, source and limits and a
// different stdin. SubmitBatch returns one token per request, in order; Poll
// then returns each unit's verdict as for Submit. Forget releases a token whose
// verdict will not be polled.
type BatchEngine interface {
	Engine
	SubmitBatch(ctx context.Context, requests []UnitRequest) (tokens []string, err error)
	Forget(token string)
}

// MaxBatchUnits is the most units sent to a BatchEngine in one job.
const MaxBatchUnits = 100

// UnitRequest is a single test-unit evaluation request forwarded to the engine.
type UnitRequest struct {
	Language       string
	SourceCode     string
	Stdin          string
	TimeLimitMS    int
	MemLimitKB     int
	ExpectedOutput string
	// IdempotencyKey identifies the unit, so an engine can return the original
	// result when the same unit is submitted again after a timeout or restart.
	IdempotencyKey string
}

// UnitVerdict is the terminal result returned by the engine for one test unit.
// A nil return from Poll means the engine has not yet produced a verdict.
type UnitVerdict struct {
	Status        string // "accepted", "wrong_answer", "time_limit_exceeded", etc.
	Stdout        string
	Stderr        string
	CompileOutput string
	TimeMS        int
	MemoryKB      int
}
