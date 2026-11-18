package authz

import "testing"

func TestLoadClientRuntimeLoadBalanceSetting(t *testing.T) {
	t.Setenv("AUTHZ_ENDPOINT", "user-headless:9443")
	t.Setenv("AUTHZ_CLIENT_LOAD_BALANCE", "")
	runtime, err := LoadClientRuntime("development")
	if err != nil || runtime.RoundRobin {
		t.Fatalf("default = %+v, %v; want no round robin", runtime, err)
	}
	t.Setenv("AUTHZ_CLIENT_LOAD_BALANCE", "Round_Robin")
	if runtime, err = LoadClientRuntime("development"); err != nil || !runtime.RoundRobin {
		t.Fatalf("round_robin = %+v, %v", runtime, err)
	}
	t.Setenv("AUTHZ_CLIENT_LOAD_BALANCE", "least_loaded")
	if _, err = LoadClientRuntime("development"); err == nil {
		t.Fatal("an unknown balancing policy was accepted")
	}
}
