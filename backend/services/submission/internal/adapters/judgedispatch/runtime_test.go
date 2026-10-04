package judgedispatch

import (
	"testing"
	"time"
)

func TestLoadRuntime(t *testing.T) {
	testCases := []struct {
		name        string
		environment string
		env         map[string]string
		wantErr     bool
		want        Runtime
	}{
		{name: "development defaults to disabled", environment: "development"},
		{name: "production cannot disable dispatch", environment: "production", env: map[string]string{"JUDGE_DISPATCH_ENABLED": "false"}, wantErr: true},
		{name: "production defaults to enabled", environment: "production", want: Runtime{Enabled: true, BatchSize: 20, LeaseSeconds: 30, PollInterval: time.Second}},
		{name: "explicit tuning", environment: "development", env: map[string]string{
			"JUDGE_DISPATCH_ENABLED": "true", "JUDGE_DISPATCH_BATCH_SIZE": "5",
			"JUDGE_DISPATCH_LEASE_SECONDS": "60", "JUDGE_DISPATCH_POLL_INTERVAL": "2s",
		}, want: Runtime{Enabled: true, BatchSize: 5, LeaseSeconds: 60, PollInterval: 2 * time.Second}},
		{name: "batch size above the bound", environment: "development", env: map[string]string{"JUDGE_DISPATCH_ENABLED": "true", "JUDGE_DISPATCH_BATCH_SIZE": "101"}, wantErr: true},
		{name: "lease below the bound", environment: "development", env: map[string]string{"JUDGE_DISPATCH_ENABLED": "true", "JUDGE_DISPATCH_LEASE_SECONDS": "4"}, wantErr: true},
		{name: "poll interval below the bound", environment: "development", env: map[string]string{"JUDGE_DISPATCH_ENABLED": "true", "JUDGE_DISPATCH_POLL_INTERVAL": "10ms"}, wantErr: true},
		{name: "malformed flag", environment: "development", env: map[string]string{"JUDGE_DISPATCH_ENABLED": "maybe"}, wantErr: true},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			for key, value := range testCase.env {
				t.Setenv(key, value)
			}
			got, err := LoadRuntime(testCase.environment)
			if (err != nil) != testCase.wantErr {
				t.Fatalf("LoadRuntime() error = %v, wantErr %t", err, testCase.wantErr)
			}
			if err == nil && got != testCase.want {
				t.Fatalf("LoadRuntime() = %+v, want %+v", got, testCase.want)
			}
		})
	}
}
