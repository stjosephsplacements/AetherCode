// Package config holds Judge wrapper-specific validated runtime configuration.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Runtime controls the private Judge gRPC listener. Production and staging
// instances always require TLS 1.3 with verified client certificates.
type Runtime struct {
	GRPCAddress                 string
	CertificateFile             string
	KeyFile                     string
	ClientCAFile                string
	AllowedSubjects             []string
	RequireMTLS                 bool
	RabbitURL                   string
	PublisherID                 string
	EngineCompatibilityApproved bool
	SubmitRate                  int
	SubmitBurst                 int
	Judge0BaseURL               string
	Judge0Timeout               time.Duration
	Judge0AuthToken             string
}

// Load returns a safe listener configuration for the supplied environment.
func Load(environment string) (Runtime, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	grpcAddress := value("JUDGE_GRPC_ADDR", ":8443")
	if !strings.Contains(grpcAddress, ":") {
		return Runtime{}, fmt.Errorf("JUDGE_GRPC_ADDR must include a port")
	}

	runtime := Runtime{
		GRPCAddress:                 grpcAddress,
		CertificateFile:             strings.TrimSpace(value("JUDGE_TLS_CERT_FILE", "")),
		KeyFile:                     strings.TrimSpace(value("JUDGE_TLS_KEY_FILE", "")),
		ClientCAFile:                strings.TrimSpace(value("JUDGE_CLIENT_CA_FILE", "")),
		AllowedSubjects:             splitSubjects(value("JUDGE_ALLOWED_CLIENT_SUBJECTS", "")),
		RequireMTLS:                 environment == "production" || environment == "staging",
		RabbitURL:                   strings.TrimSpace(value("JUDGE_RABBITMQ_URL", "")),
		PublisherID:                 strings.TrimSpace(value("JUDGE_PUBLISHER_ID", "judge-admission-publisher")),
		EngineCompatibilityApproved: strings.TrimSpace(value("JUDGE_ENGINE_COMPATIBILITY_APPROVED", "false")) == "true",
	}
	runtime.Judge0BaseURL = strings.TrimSpace(value("JUDGE0_BASE_URL", ""))
	judge0TimeoutSeconds := strings.TrimSpace(value("JUDGE0_TIMEOUT_SECONDS", "10"))
	timeoutSeconds, timeoutErr := strconv.Atoi(judge0TimeoutSeconds)
	if timeoutErr != nil || timeoutSeconds < 1 || timeoutSeconds > 120 {
		return Runtime{}, fmt.Errorf("JUDGE0_TIMEOUT_SECONDS must be an integer between 1 and 120")
	}
	runtime.Judge0Timeout = time.Duration(timeoutSeconds) * time.Second
	configuredFiles := 0
	for _, file := range []string{runtime.CertificateFile, runtime.KeyFile, runtime.ClientCAFile} {
		if file != "" {
			configuredFiles++
		}
	}
	if runtime.RequireMTLS && configuredFiles != 3 {
		return Runtime{}, fmt.Errorf("judge TLS certificate, key, and client CA are required in %s", environment)
	}
	if !runtime.RequireMTLS && configuredFiles != 0 && configuredFiles != 3 {
		return Runtime{}, fmt.Errorf("judge TLS certificate, key, and client CA must be configured together")
	}
	if configuredFiles == 3 {
		runtime.RequireMTLS = true
	}
	if runtime.RequireMTLS && len(runtime.AllowedSubjects) == 0 {
		return Runtime{}, fmt.Errorf("JUDGE_ALLOWED_CLIENT_SUBJECTS is required when Judge mTLS is enabled")
	}
	if runtime.RequireMTLS && runtime.RabbitURL == "" {
		return Runtime{}, fmt.Errorf("JUDGE_RABBITMQ_URL is required in %s", environment)
	}
	if runtime.RabbitURL != "" && (runtime.PublisherID == "" || len(runtime.PublisherID) > 255) {
		return Runtime{}, fmt.Errorf("JUDGE_PUBLISHER_ID must contain 1 to 255 characters when RabbitMQ is configured")
	}
	compatibilityValue := strings.TrimSpace(value("JUDGE_ENGINE_COMPATIBILITY_APPROVED", "false"))
	if compatibilityValue != "true" && compatibilityValue != "false" {
		return Runtime{}, fmt.Errorf("JUDGE_ENGINE_COMPATIBILITY_APPROVED must be true or false")
	}
	if runtime.RequireMTLS && !runtime.EngineCompatibilityApproved {
		return Runtime{}, fmt.Errorf("JUDGE_ENGINE_COMPATIBILITY_APPROVED=true is required in %s", environment)
	}
	// SubmitRate/SubmitBurst are a coarse, tenant-wide abuse backstop keyed on
	// tenant_fairness_key (one whole college, not one candidate). Dispatch
	// fairness across tenants is a separate, already-existing concern owned by
	// the judge dispatcher; this limiter exists only to catch a runaway retry
	// loop or a scripted flood, not to throttle legitimate exam traffic. The
	// defaults are sized for roughly 500 concurrently examined candidates each
	// running/testing code up to 20 times within a single peak hour (10000
	// admissions/hour of genuine load), doubled for headroom.
	submitRate, err := positiveInt("JUDGE_SUBMIT_RATE", "20000", 1, 50000)
	if err != nil {
		return Runtime{}, err
	}
	submitBurst, err := positiveInt("JUDGE_SUBMIT_BURST", "2000", 1, 5000)
	if err != nil {
		return Runtime{}, err
	}
	runtime.SubmitRate = submitRate
	runtime.SubmitBurst = submitBurst
	runtime.Judge0AuthToken = strings.TrimSpace(value("JUDGE0_AUTH_TOKEN", ""))
	return runtime, nil
}

func positiveInt(key, fallback string, minimum, maximum int) (int, error) {
	parsed, err := strconv.Atoi(value(key, fallback))
	if err != nil || parsed < minimum || parsed > maximum {
		return 0, fmt.Errorf("%s must be between %d and %d", key, minimum, maximum)
	}
	return parsed, nil
}

func splitSubjects(raw string) []string {
	values := make([]string, 0)
	for _, value := range strings.Split(raw, ",") {
		if value = strings.TrimSpace(value); value != "" {
			values = append(values, value)
		}
	}
	return values
}

func value(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
