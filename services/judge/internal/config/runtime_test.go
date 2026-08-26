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

func TestLoadProductionBootsWithStubEngineAndNoJudge0BaseURL(t *testing.T) {
	// JUDGE_ENGINE_COMPATIBILITY_APPROVED is independently required in
	// production regardless of which dispatcher engine is actually in use, so
	// config.Load must not additionally require JUDGE0_BASE_URL: a production
	// deployment running JUDGE_ENGINE=stub with the dispatcher disabled (or
	// enabled with the stub engine) never touches the Judge0 client and must
	// still be able to boot.
	t.Setenv("JUDGE_TLS_CERT_FILE", "/tls/tls.crt")
	t.Setenv("JUDGE_TLS_KEY_FILE", "/tls/tls.key")
	t.Setenv("JUDGE_CLIENT_CA_FILE", "/tls/ca.crt")
	t.Setenv("JUDGE_ALLOWED_CLIENT_SUBJECTS", "submission-adapter")
	t.Setenv("JUDGE_RABBITMQ_URL", "amqp://judge:secret@rabbitmq/judge")
	t.Setenv("JUDGE_ENGINE_COMPATIBILITY_APPROVED", "true")
	t.Setenv("JUDGE0_BASE_URL", "")
	t.Setenv("JUDGE_ENGINE", "stub")

	runtime, err := Load("production")
	if err != nil {
		t.Fatalf("Load() error = %v, want production to boot with JUDGE_ENGINE=stub and no JUDGE0_BASE_URL", err)
	}
	if runtime.Judge0BaseURL != "" {
		t.Fatalf("Judge0BaseURL = %q, want empty", runtime.Judge0BaseURL)
	}
}

func TestLoadJudge0TimeoutSecondsValidation(t *testing.T) {
	testCases := []struct {
		name    string
		value   string
		wantErr bool
	}{
		{name: "zero rejected", value: "0", wantErr: true},
		{name: "121 rejected", value: "121", wantErr: true},
		{name: "1 accepted", value: "1", wantErr: false},
		{name: "120 accepted", value: "120", wantErr: false},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Setenv("JUDGE0_TIMEOUT_SECONDS", testCase.value)

			_, err := Load("development")
			if testCase.wantErr && err == nil {
				t.Fatalf("Load() with JUDGE0_TIMEOUT_SECONDS=%s error = nil, want an error", testCase.value)
			}
			if !testCase.wantErr && err != nil {
				t.Fatalf("Load() with JUDGE0_TIMEOUT_SECONDS=%s error = %v, want nil", testCase.value, err)
			}
		})
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
