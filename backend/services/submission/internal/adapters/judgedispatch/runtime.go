// Package judgedispatch admits graded work to the isolated Judge wrapper. It
// claims queued evaluation requests, submits each as an execution job, and
// records the job Judge accepted; results come back through judgecompletion.
// Like that bridge it holds no source, test data, or KMS material: it passes
// Judge the encrypted object references and the names of the keys to decrypt
// them with.
package judgedispatch

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Runtime is the fail-closed configuration for the dispatcher. The Judge
// endpoint and mutual-TLS identity are the completion bridge's
// (JUDGE_COMPLETION_*); the dispatcher only adds its own pacing.
type Runtime struct {
	Enabled      bool
	BatchSize    uint32
	LeaseSeconds uint32
	PollInterval time.Duration
}

// LoadRuntime refuses to disable dispatch in staging and production: queued
// evaluation requests would never be graded.
func LoadRuntime(environment string) (Runtime, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	required := environment == "staging" || environment == "production"
	enabled, err := boolValue("JUDGE_DISPATCH_ENABLED", required)
	if err != nil {
		return Runtime{}, err
	}
	if !enabled {
		if required {
			return Runtime{}, fmt.Errorf("JUDGE_DISPATCH_ENABLED=true is required in %s", environment)
		}
		return Runtime{}, nil
	}
	runtime := Runtime{Enabled: true}
	if runtime.BatchSize, err = uint32Value("JUDGE_DISPATCH_BATCH_SIZE", 20, 1, 100); err != nil {
		return Runtime{}, err
	}
	if runtime.LeaseSeconds, err = uint32Value("JUDGE_DISPATCH_LEASE_SECONDS", 30, 5, 300); err != nil {
		return Runtime{}, err
	}
	if runtime.PollInterval, err = durationValue("JUDGE_DISPATCH_POLL_INTERVAL", time.Second, 250*time.Millisecond, time.Minute); err != nil {
		return Runtime{}, err
	}
	return runtime, nil
}

// ReadyWindow bounds how stale the last successful claim cycle may be.
func (runtime Runtime) ReadyWindow() time.Duration {
	return runtime.PollInterval*3 + time.Duration(runtime.LeaseSeconds)*time.Second
}

func boolValue(key string, fallback bool) (bool, error) {
	value, err := strconv.ParseBool(strings.TrimSpace(env(key, strconv.FormatBool(fallback))))
	if err != nil {
		return false, fmt.Errorf("%s must be true or false", key)
	}
	return value, nil
}

func uint32Value(key string, fallback, minimum, maximum uint32) (uint32, error) {
	value, err := strconv.ParseUint(strings.TrimSpace(env(key, strconv.FormatUint(uint64(fallback), 10))), 10, 32)
	if err != nil || value < uint64(minimum) || value > uint64(maximum) {
		return 0, fmt.Errorf("%s must be between %d and %d", key, minimum, maximum)
	}
	return uint32(value), nil
}

func durationValue(key string, fallback, minimum, maximum time.Duration) (time.Duration, error) {
	value, err := time.ParseDuration(strings.TrimSpace(env(key, fallback.String())))
	if err != nil || value < minimum || value > maximum {
		return 0, fmt.Errorf("%s must be between %s and %s", key, minimum, maximum)
	}
	return value, nil
}

func env(key, fallback string) string {
	if value, found := os.LookupEnv(key); found {
		return value
	}
	return fallback
}
