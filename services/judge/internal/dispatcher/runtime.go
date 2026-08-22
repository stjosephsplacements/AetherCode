package dispatcher

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Runtime holds validated dispatcher configuration loaded from the environment.
type Runtime struct {
	Enabled         bool
	EngineType      string
	Concurrency     int
	PollIntervalMS  int
	MaxPollAttempts int
}

// LoadRuntime reads and validates dispatcher configuration from environment
// variables. Validation of engine-specific constraints is only applied when
// the dispatcher is enabled, so services that do not enable the dispatcher
// are not forced to supply engine-specific configuration.
func LoadRuntime() (Runtime, error) {
	env := func(name, def string) string {
		if v := os.Getenv(name); v != "" {
			return v
		}
		return def
	}
	intEnv := func(name string, def int) (int, error) {
		s := os.Getenv(name)
		if s == "" {
			return def, nil
		}
		v, err := strconv.Atoi(s)
		if err != nil {
			return 0, fmt.Errorf("dispatcher: %s must be an integer: %w", name, err)
		}
		return v, nil
	}

	r := Runtime{
		Enabled:    strings.EqualFold(env("JUDGE_DISPATCHER_ENABLED", "false"), "true"),
		EngineType: env("JUDGE_ENGINE", "stub"),
	}
	var err error
	if r.Concurrency, err = intEnv("JUDGE_WORKER_CONCURRENCY", 4); err != nil {
		return Runtime{}, err
	}
	if r.PollIntervalMS, err = intEnv("JUDGE_POLL_INTERVAL_MS", 2000); err != nil {
		return Runtime{}, err
	}
	if r.MaxPollAttempts, err = intEnv("JUDGE_MAX_POLL_ATTEMPTS", 30); err != nil {
		return Runtime{}, err
	}

	if r.Enabled {
		if r.EngineType != "stub" && r.EngineType != "judge0" {
			return Runtime{}, fmt.Errorf("dispatcher: JUDGE_ENGINE must be stub or judge0, got %q", r.EngineType)
		}
		if r.Concurrency < 1 || r.Concurrency > 32 {
			return Runtime{}, fmt.Errorf("dispatcher: JUDGE_WORKER_CONCURRENCY must be 1-32")
		}
		if r.MaxPollAttempts < 1 {
			return Runtime{}, fmt.Errorf("dispatcher: JUDGE_MAX_POLL_ATTEMPTS must be >= 1")
		}
	}
	return r, nil
}
