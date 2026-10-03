// Package judgecompletion pulls terminal results from the isolated Judge
// wrapper. It intentionally contains no Judge0, object-storage, or KMS client.
package judgecompletion

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"time"
)

// Runtime is the fail-closed configuration for Submission's private Judge
// completion bridge. The adapter is receive-only; it never admits work to the
// wrapper from this package.
type Runtime struct {
	Enabled         bool
	Endpoint        string
	CertificateFile string
	KeyFile         string
	CAFile          string
	ServerName      string
	ConsumerID      string
	BatchSize       uint32
	LeaseSeconds    uint32
	PollInterval    time.Duration
	RPCTimeout      time.Duration
}

// LoadRuntime refuses an enabled bridge without mutual TLS, a bounded lease,
// or a stable consumer identity. Staging and production cannot disable the
// bridge because that would strand durable Judge completions indefinitely.
func LoadRuntime(environment string) (Runtime, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	defaultEnabled := environment == "staging" || environment == "production"
	enabled, err := boolValue("JUDGE_COMPLETION_ENABLED", defaultEnabled)
	if err != nil {
		return Runtime{}, err
	}
	if !enabled {
		if defaultEnabled {
			return Runtime{}, fmt.Errorf("JUDGE_COMPLETION_ENABLED=true is required in %s", environment)
		}
		return Runtime{}, nil
	}

	runtime := Runtime{
		Enabled:         true,
		Endpoint:        strings.TrimSpace(env("JUDGE_COMPLETION_GRPC_ADDR", "")),
		CertificateFile: strings.TrimSpace(env("JUDGE_COMPLETION_TLS_CERT_FILE", "")),
		KeyFile:         strings.TrimSpace(env("JUDGE_COMPLETION_TLS_KEY_FILE", "")),
		CAFile:          strings.TrimSpace(env("JUDGE_COMPLETION_TLS_CA_FILE", "")),
		ServerName:      strings.TrimSpace(env("JUDGE_COMPLETION_TLS_SERVER_NAME", "")),
		ConsumerID:      strings.TrimSpace(env("JUDGE_COMPLETION_CONSUMER_ID", "submission-judge-completion")),
	}
	endpointHost, _, splitErr := net.SplitHostPort(runtime.Endpoint)
	if runtime.Endpoint == "" || splitErr != nil || strings.Trim(strings.TrimSpace(endpointHost), "[]") == "" {
		return Runtime{}, fmt.Errorf("JUDGE_COMPLETION_GRPC_ADDR must include a host and port when the bridge is enabled")
	}
	for _, field := range []struct {
		name  string
		value string
	}{
		{"JUDGE_COMPLETION_TLS_CERT_FILE", runtime.CertificateFile},
		{"JUDGE_COMPLETION_TLS_KEY_FILE", runtime.KeyFile},
		{"JUDGE_COMPLETION_TLS_CA_FILE", runtime.CAFile},
	} {
		if field.value == "" {
			return Runtime{}, fmt.Errorf("%s is required when the Judge completion bridge is enabled", field.name)
		}
	}
	if length := len([]rune(runtime.ConsumerID)); length < 1 || length > 255 {
		return Runtime{}, fmt.Errorf("JUDGE_COMPLETION_CONSUMER_ID must contain 1 to 255 characters")
	}
	if runtime.BatchSize, err = uint32Value("JUDGE_COMPLETION_BATCH_SIZE", 50, 1, 100); err != nil {
		return Runtime{}, err
	}
	if runtime.LeaseSeconds, err = uint32Value("JUDGE_COMPLETION_LEASE_SECONDS", 60, 5, 300); err != nil {
		return Runtime{}, err
	}
	if runtime.PollInterval, err = durationValue("JUDGE_COMPLETION_POLL_INTERVAL", time.Second, 250*time.Millisecond, time.Minute); err != nil {
		return Runtime{}, err
	}
	if runtime.RPCTimeout, err = durationValue("JUDGE_COMPLETION_RPC_TIMEOUT", 10*time.Second, time.Second, 30*time.Second); err != nil {
		return Runtime{}, err
	}
	return runtime, nil
}

func (runtime Runtime) ReadyWindow() time.Duration {
	return runtime.PollInterval*3 + runtime.RPCTimeout
}

func boolValue(key string, fallback bool) (bool, error) {
	raw := strings.TrimSpace(env(key, strconv.FormatBool(fallback)))
	value, err := strconv.ParseBool(raw)
	if err != nil {
		return false, fmt.Errorf("%s must be true or false", key)
	}
	return value, nil
}

func uint32Value(key string, fallback, minimum, maximum uint32) (uint32, error) {
	raw := strings.TrimSpace(env(key, strconv.FormatUint(uint64(fallback), 10)))
	value, err := strconv.ParseUint(raw, 10, 32)
	if err != nil || value < uint64(minimum) || value > uint64(maximum) {
		return 0, fmt.Errorf("%s must be between %d and %d", key, minimum, maximum)
	}
	return uint32(value), nil
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
