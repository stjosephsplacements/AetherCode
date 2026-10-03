// Package judge0 contains evaluation engine adapters for the judge dispatcher.
package judge0

import (
	"context"
	"fmt"
	"sync"

	"github.com/aethercode/aethercode/services/judge/internal/dispatcher"
)

// Stub is a deterministic fake evaluation engine that immediately accepts any
// submission. It is used when JUDGE_ENGINE=stub (the default) so that the full
// dispatch pipeline can be exercised without a real Judge0 installation or
// gVisor approval.
// Safe for concurrent use.
type Stub struct {
	mu      sync.Mutex
	counter int
}

// NewStub creates a Stub engine.
func NewStub() *Stub { return &Stub{} }

// Submit records a submission and returns a unique token. The request content
// is ignored because the stub always accepts.
func (s *Stub) Submit(_ context.Context, _ dispatcher.UnitRequest) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.counter++
	return fmt.Sprintf("stub-token-%d", s.counter), nil
}

// Poll always returns an accepted verdict immediately. A real engine adapter
// would return nil until the engine reports a terminal state.
func (s *Stub) Poll(_ context.Context, _ string) (*dispatcher.UnitVerdict, error) {
	return &dispatcher.UnitVerdict{Status: "accepted", TimeMS: 42, MemoryKB: 1024}, nil
}
