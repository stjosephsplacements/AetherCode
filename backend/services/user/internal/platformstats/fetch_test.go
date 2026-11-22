package platformstats

import "testing"

func TestStaleOnRateLimit(t *testing.T) {
	t.Parallel()
	if staleOnRateLimit(nil) != "failed" {
		t.Fatal("expected failed for nil")
	}
	if staleOnRateLimit(errString("rate limited")) != "stale" {
		t.Fatal("expected stale for rate limit")
	}
}

type errString string

func (value errString) Error() string { return string(value) }