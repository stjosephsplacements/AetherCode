// Package dispatcher coordinates execution job dispatch and verdict collection.
package dispatcher

import "context"

// Engine is the evaluation engine port. The stub is used by default;
// the Judge0 adapter activates when JUDGE_ENGINE=judge0 (gVisor gate required).
type Engine interface {
	Submit(ctx context.Context, req UnitRequest) (token string, err error)
	Poll(ctx context.Context, token string) (*UnitVerdict, error)
}

// UnitRequest is a single test-unit evaluation request forwarded to the engine.
type UnitRequest struct {
	Language       string
	SourceCode     string
	Stdin          string
	TimeLimitMS    int
	MemLimitKB     int
	ExpectedOutput string
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
