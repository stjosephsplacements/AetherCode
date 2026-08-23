// Package config validates Submission's security-sensitive runtime settings.
package config

import (
	"fmt"
	"os"
	"strconv"
)

// Runtime holds the validated rate-limit configuration for Submission's HTTP
// adapter.
type Runtime struct {
	StartAttemptRate  int
	StartAttemptBurst int
}

// Load reads and validates Submission's rate-limit environment variables.
func Load() (Runtime, error) {
	startAttemptRate, err := positiveInt("SUBMISSION_START_ATTEMPT_RATE", "30", 1, 1000)
	if err != nil {
		return Runtime{}, err
	}
	startAttemptBurst, err := positiveInt("SUBMISSION_START_ATTEMPT_BURST", "10", 1, 100)
	if err != nil {
		return Runtime{}, err
	}
	return Runtime{
		StartAttemptRate:  startAttemptRate,
		StartAttemptBurst: startAttemptBurst,
	}, nil
}

func positiveInt(key, fallback string, minimum, maximum int) (int, error) {
	parsed, err := strconv.Atoi(value(key, fallback))
	if err != nil || parsed < minimum || parsed > maximum {
		return 0, fmt.Errorf("%s must be between %d and %d", key, minimum, maximum)
	}
	return parsed, nil
}

func value(key, fallback string) string {
	if configured, found := os.LookupEnv(key); found {
		return configured
	}
	return fallback
}
