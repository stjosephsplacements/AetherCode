package platformstats

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Runtime struct {
	Enabled       bool
	PollInterval  time.Duration
	BatchSize     int
	LinkSyncEvery time.Duration
}

func LoadRuntime(environment string) (Runtime, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	required := environment == "staging" || environment == "production"
	enabled, err := boolValue("USER_PLATFORM_STATS_ENABLED", required)
	if err != nil {
		return Runtime{}, err
	}
	if !enabled {
		if required {
			return Runtime{}, fmt.Errorf("USER_PLATFORM_STATS_ENABLED=true is required in %s", environment)
		}
		return Runtime{Enabled: false}, nil
	}
	runtime := Runtime{Enabled: true}
	if runtime.PollInterval, err = durationValue("USER_PLATFORM_STATS_POLL_INTERVAL", 15*time.Minute, time.Minute, 12*time.Hour); err != nil {
		return Runtime{}, err
	}
	if runtime.BatchSize, err = integerValue("USER_PLATFORM_STATS_BATCH_SIZE", 8, 1, 50); err != nil {
		return Runtime{}, err
	}
	if runtime.LinkSyncEvery, err = durationValue("USER_PLATFORM_STATS_LINK_SYNC_INTERVAL", 6*time.Hour, time.Minute, 24*time.Hour); err != nil {
		return Runtime{}, err
	}
	return runtime, nil
}

func (runtime Runtime) ReadyWindow() time.Duration {
	return runtime.PollInterval * 3
}

func boolValue(key string, fallback bool) (bool, error) {
	raw := strings.TrimSpace(env(key, strconv.FormatBool(fallback)))
	value, err := strconv.ParseBool(raw)
	if err != nil {
		return false, fmt.Errorf("%s must be true or false", key)
	}
	return value, nil
}

func integerValue(key string, fallback, minimum, maximum int) (int, error) {
	raw := strings.TrimSpace(env(key, strconv.Itoa(fallback)))
	value, err := strconv.Atoi(raw)
	if err != nil || value < minimum || value > maximum {
		return 0, fmt.Errorf("%s must be between %d and %d", key, minimum, maximum)
	}
	return value, nil
}

func durationValue(key string, fallback, minimum, maximum time.Duration) (time.Duration, error) {
	raw := strings.TrimSpace(env(key, fallback.String()))
	value, err := time.ParseDuration(raw)
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