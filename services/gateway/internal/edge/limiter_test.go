package edge

import (
	"testing"
	"time"
)

func TestLimiterBoundsEntriesAndEvictsIdleBuckets(t *testing.T) {
	limiter, err := NewLimiter(RateLimitConfig{Capacity: 1, RefillPerSecond: 1, MaxEntries: 2, IdleTTL: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	if !limiter.Allow("one", now) || !limiter.Allow("two", now) {
		t.Fatal("initial buckets should be admitted")
	}
	if !limiter.Allow("three", now.Add(2*time.Second)) {
		t.Fatal("idle buckets should be evicted before a new principal is admitted")
	}
	if len(limiter.buckets) > 2 {
		t.Fatalf("bucket map exceeded bound: %d", len(limiter.buckets))
	}
}

func TestLimiterRejectsBurstOverCapacity(t *testing.T) {
	limiter, err := NewLimiter(RateLimitConfig{Capacity: 1, RefillPerSecond: 0.01, MaxEntries: 2, IdleTTL: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	if !limiter.Allow("principal:one", now) {
		t.Fatal("first request should be admitted")
	}
	if limiter.Allow("principal:one", now) {
		t.Fatal("burst over capacity should be rejected")
	}
}
