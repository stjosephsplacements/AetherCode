// Package retention runs the Notification retention boundary with a dedicated
// database identity. It has no provider, object-storage, or request-serving
// capability.
package retention

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Runtime is the bounded, fail-closed configuration for the retention worker.
type Runtime struct {
	Enabled      bool
	BatchSize    int
	MaxBatches   int
	PollInterval time.Duration
}

// LoadRuntime requires retention processing in staging and production. A
// deployment may disable it only in development/test, where no real retained
// customer data is accepted.
func LoadRuntime(environment string) (Runtime, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	required := environment == "staging" || environment == "production"
	enabled, err := boolValue("NOTIFICATION_RETENTION_ENABLED", required)
	if err != nil {
		return Runtime{}, err
	}
	if !enabled {
		if required {
			return Runtime{}, fmt.Errorf("NOTIFICATION_RETENTION_ENABLED=true is required in %s", environment)
		}
		return Runtime{}, nil
	}

	runtime := Runtime{Enabled: true}
	if runtime.BatchSize, err = integerValue("NOTIFICATION_RETENTION_BATCH_SIZE", 1000, 1, 10000); err != nil {
		return Runtime{}, err
	}
	if runtime.MaxBatches, err = integerValue("NOTIFICATION_RETENTION_MAX_BATCHES", 20, 1, 100); err != nil {
		return Runtime{}, err
	}
	if runtime.PollInterval, err = durationValue("NOTIFICATION_RETENTION_POLL_INTERVAL", time.Minute, 10*time.Second, time.Hour); err != nil {
		return Runtime{}, err
	}
	return runtime, nil
}

// ReadyWindow allows bounded scheduling delay while still failing readiness if
// a worker can no longer execute its dedicated retention procedure.
func (runtime Runtime) ReadyWindow() time.Duration {
	return runtime.PollInterval * 3
}

func boolValue(key string, fallback bool) (bool, error) {
	raw := strings.TrimSpace(environmentValue(key, strconv.FormatBool(fallback)))
	value, err := strconv.ParseBool(raw)
	if err != nil {
		return false, fmt.Errorf("%s must be true or false", key)
	}
	return value, nil
}

func integerValue(key string, fallback, minimum, maximum int) (int, error) {
	raw := strings.TrimSpace(environmentValue(key, strconv.Itoa(fallback)))
	value, err := strconv.Atoi(raw)
	if err != nil || value < minimum || value > maximum {
		return 0, fmt.Errorf("%s must be between %d and %d", key, minimum, maximum)
	}
	return value, nil
}

func durationValue(key string, fallback, minimum, maximum time.Duration) (time.Duration, error) {
	raw := strings.TrimSpace(environmentValue(key, fallback.String()))
	value, err := time.ParseDuration(raw)
	if err != nil || value < minimum || value > maximum {
		return 0, fmt.Errorf("%s must be between %s and %s", key, minimum, maximum)
	}
	return value, nil
}

func environmentValue(key, fallback string) string {
	if value, found := os.LookupEnv(key); found {
		return value
	}
	return fallback
}
