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
	runtime, err := Load("production")
	if err != nil {
		t.Fatalf("Load approved production runtime: %v", err)
	}
	if !runtime.EngineCompatibilityApproved || !runtime.RequireMTLS {
		t.Fatalf("Load approved runtime = %#v", runtime)
	}
}
