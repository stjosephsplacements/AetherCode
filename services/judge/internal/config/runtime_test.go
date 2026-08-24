package config

import "testing"

func TestLoadRejectsProductionWithoutTLS(t *testing.T) {
	t.Setenv("JUDGE_TLS_CERT_FILE", "")
	t.Setenv("JUDGE_TLS_KEY_FILE", "")
	t.Setenv("JUDGE_CLIENT_CA_FILE", "")
	t.Setenv("JUDGE_ALLOWED_CLIENT_SUBJECTS", "")

	if _, err := Load("production"); err == nil {
		t.Fatal("Load accepted a production listener without mTLS")
	}
}

func TestLoadAllowsExplicitDevelopmentInsecureListener(t *testing.T) {
	t.Setenv("JUDGE_TLS_CERT_FILE", "")
	t.Setenv("JUDGE_TLS_KEY_FILE", "")
	t.Setenv("JUDGE_CLIENT_CA_FILE", "")

	runtime, err := Load("development")
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if runtime.RequireMTLS {
		t.Fatal("development listener unexpectedly requires mTLS")
	}
}

func TestLoadRejectsProductionWithoutApprovedEngineGate(t *testing.T) {
	t.Setenv("JUDGE_TLS_CERT_FILE", "/tls/tls.crt")
	t.Setenv("JUDGE_TLS_KEY_FILE", "/tls/tls.key")
	t.Setenv("JUDGE_CLIENT_CA_FILE", "/tls/ca.crt")
	t.Setenv("JUDGE_ALLOWED_CLIENT_SUBJECTS", "submission-adapter")
	t.Setenv("JUDGE_RABBITMQ_URL", "amqp://judge:secret@rabbitmq/judge")
	t.Setenv("JUDGE_ENGINE_COMPATIBILITY_APPROVED", "false")

	if _, err := Load("production"); err == nil {
		t.Fatal("Load accepted production Judge runtime without gVisor compatibility approval")
	}

	t.Setenv("JUDGE_ENGINE_COMPATIBILITY_APPROVED", "true")
	t.Setenv("JUDGE0_BASE_URL", "http://judge0.internal:2358")
	runtime, err := Load("production")
	if err != nil {
		t.Fatalf("Load approved production runtime: %v", err)
	}
	if !runtime.EngineCompatibilityApproved || !runtime.RequireMTLS {
		t.Fatalf("Load approved runtime = %#v", runtime)
	}
}

func TestLoadJudge0BaseURLRequiredWhenEngineIsJudge0(t *testing.T) {
	t.Setenv("JUDGE_ENGINE_COMPATIBILITY_APPROVED", "true")
	t.Setenv("JUDGE0_BASE_URL", "")

	if _, err := Load("development"); err == nil {
		t.Fatal("Load() error = nil, want an error when JUDGE0_BASE_URL is unset")
	}
}

func TestLoadJudge0BaseURLAccepted(t *testing.T) {
	t.Setenv("JUDGE0_BASE_URL", "http://judge0.internal:2358")

	runtime, err := Load("development")
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if runtime.Judge0BaseURL != "http://judge0.internal:2358" {
		t.Fatalf("Judge0BaseURL = %q, want %q", runtime.Judge0BaseURL, "http://judge0.internal:2358")
	}
}
