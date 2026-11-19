package dispatcher

import "testing"

func TestLoadRuntimeJobTimeout(t *testing.T) {
	t.Setenv("JUDGE_DISPATCHER_ENABLED", "true")
	t.Setenv("JUDGE_ENGINE", "stub")
	// Pin every input so inherited configuration cannot change what is asserted.
	t.Setenv("JUDGE_WORKER_CONCURRENCY", "4")
	t.Setenv("JUDGE_POLL_INTERVAL_MS", "2000")
	t.Setenv("JUDGE_MAX_POLL_ATTEMPTS", "30")
	t.Setenv("JUDGE_JOB_TIMEOUT_SECONDS", "")

	runtime, err := LoadRuntime()
	if err != nil || runtime.JobTimeoutSeconds != 900 {
		t.Fatalf("default job timeout = %d, err %v; want 900", runtime.JobTimeoutSeconds, err)
	}

	t.Setenv("JUDGE_JOB_TIMEOUT_SECONDS", "10")
	if _, err := LoadRuntime(); err == nil {
		t.Fatal("a job timeout under 30 s must be refused")
	}

	// A unit may poll for 60 s (30 attempts x 2 s); a job deadline below that would cancel legitimate work.
	t.Setenv("JUDGE_JOB_TIMEOUT_SECONDS", "45")
	t.Setenv("JUDGE_MAX_POLL_ATTEMPTS", "30")
	t.Setenv("JUDGE_POLL_INTERVAL_MS", "2000")
	if _, err := LoadRuntime(); err == nil {
		t.Fatal("a job timeout shorter than one unit's polling time must be refused")
	}

	t.Setenv("JUDGE_JOB_TIMEOUT_SECONDS", "10000000000")
	if _, err := LoadRuntime(); err == nil {
		t.Fatal("a job timeout that would overflow a time.Duration must be refused")
	}

	t.Setenv("JUDGE_JOB_TIMEOUT_SECONDS", "120")
	if runtime, err := LoadRuntime(); err != nil || runtime.JobTimeoutSeconds != 120 {
		t.Fatalf("job timeout = %d, err %v; want 120", runtime.JobTimeoutSeconds, err)
	}
}
