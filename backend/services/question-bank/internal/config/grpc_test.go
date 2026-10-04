package config

import "testing"

func TestLoadGRPC(t *testing.T) {
	for name, scenario := range map[string]struct {
		environment string
		env         map[string]string
		wantErr     bool
		wantMTLS    bool
	}{
		"development plaintext": {environment: "development"},
		"production needs TLS":  {environment: "production", wantErr: true},
		"partial TLS files":     {environment: "development", env: map[string]string{"QBANK_GRPC_TLS_CERT_FILE": "c"}, wantErr: true},
		"TLS needs allow-list": {environment: "production", env: map[string]string{
			"QBANK_GRPC_TLS_CERT_FILE": "c", "QBANK_GRPC_TLS_KEY_FILE": "k", "QBANK_GRPC_CLIENT_CA_FILE": "ca",
		}, wantErr: true},
		"production complete": {environment: "production", wantMTLS: true, env: map[string]string{
			"QBANK_GRPC_TLS_CERT_FILE": "c", "QBANK_GRPC_TLS_KEY_FILE": "k", "QBANK_GRPC_CLIENT_CA_FILE": "ca",
			"QBANK_GRPC_ALLOWED_CLIENT_SUBJECTS": "assessment",
		}},
	} {
		t.Run(name, func(t *testing.T) {
			for _, key := range []string{"QBANK_GRPC_ADDR", "QBANK_GRPC_TLS_CERT_FILE", "QBANK_GRPC_TLS_KEY_FILE", "QBANK_GRPC_CLIENT_CA_FILE", "QBANK_GRPC_ALLOWED_CLIENT_SUBJECTS"} {
				t.Setenv(key, scenario.env[key])
			}
			runtime, err := LoadGRPC(scenario.environment)
			if (err != nil) != scenario.wantErr || (err == nil && runtime.RequireMTLS != scenario.wantMTLS) {
				t.Fatalf("LoadGRPC() = %#v, %v", runtime, err)
			}
		})
	}
}
