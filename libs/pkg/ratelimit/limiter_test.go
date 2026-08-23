package ratelimit

import (
	"testing"
	"time"
)

func TestNewRejectsNonPositiveConfig(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		config Config
	}{
		{"zero capacity", Config{Capacity: 0, RefillPerSecond: 1, MaxEntries: 1, IdleTTL: time.Second}},
		{"negative capacity", Config{Capacity: -1, RefillPerSecond: 1, MaxEntries: 1, IdleTTL: time.Second}},
		{"zero refill", Config{Capacity: 1, RefillPerSecond: 0, MaxEntries: 1, IdleTTL: time.Second}},
		{"negative refill", Config{Capacity: 1, RefillPerSecond: -1, MaxEntries: 1, IdleTTL: time.Second}},
		{"zero max entries", Config{Capacity: 1, RefillPerSecond: 1, MaxEntries: 0, IdleTTL: time.Second}},
		{"negative max entries", Config{Capacity: 1, RefillPerSecond: 1, MaxEntries: -1, IdleTTL: time.Second}},
		{"zero idle ttl", Config{Capacity: 1, RefillPerSecond: 1, MaxEntries: 1, IdleTTL: 0}},
		{"negative idle ttl", Config{Capacity: 1, RefillPerSecond: 1, MaxEntries: 1, IdleTTL: -time.Second}},
	}

	for _, testCase := range tests {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			if _, err := New(testCase.config); err == nil {
				t.Fatal("expected error for non-positive configuration")
			}
		})
	}
}

func TestAllowNilLimiterRejects(t *testing.T) {
	t.Parallel()

	var limiter *Limiter
	if limiter.Allow("key", time.Now()) {
		t.Fatal("nil limiter should reject")
	}
}

func TestAllowEmptyKeyRejects(t *testing.T) {
	t.Parallel()

	limiter, err := New(Config{Capacity: 1, RefillPerSecond: 1, MaxEntries: 2, IdleTTL: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if limiter.Allow("", time.Now()) {
		t.Fatal("empty key should reject")
	}
}

func TestLimiterBoundsEntriesAndEvictsIdleBuckets(t *testing.T) {
	t.Parallel()

	limiter, err := New(Config{Capacity: 1, RefillPerSecond: 1, MaxEntries: 2, IdleTTL: time.Second})
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
	t.Parallel()

	limiter, err := New(Config{Capacity: 1, RefillPerSecond: 0.01, MaxEntries: 2, IdleTTL: time.Minute})
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

func TestLimiterRefillsOverTime(t *testing.T) {
	t.Parallel()

	limiter, err := New(Config{Capacity: 1, RefillPerSecond: 1, MaxEntries: 2, IdleTTL: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	if !limiter.Allow("principal:one", now) {
		t.Fatal("first request should be admitted")
	}
	if limiter.Allow("principal:one", now) {
		t.Fatal("second request before refill should be rejected")
	}
	if !limiter.Allow("principal:one", now.Add(time.Second)) {
		t.Fatal("request after refill interval should be admitted")
	}
}

func TestLimiterEvictsOldestWhenAtCapacity(t *testing.T) {
	t.Parallel()

	limiter, err := New(Config{Capacity: 1, RefillPerSecond: 1, MaxEntries: 2, IdleTTL: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	if !limiter.Allow("one", now) {
		t.Fatal("first principal should be admitted")
	}
	if !limiter.Allow("two", now.Add(time.Millisecond)) {
		t.Fatal("second principal should be admitted")
	}
	if !limiter.Allow("three", now.Add(2*time.Millisecond)) {
		t.Fatal("third principal should evict the oldest entry rather than being rejected")
	}
	if len(limiter.buckets) > 2 {
		t.Fatalf("bucket map exceeded bound: %d", len(limiter.buckets))
	}
	if _, exists := limiter.buckets["one"]; exists {
		t.Fatal("oldest entry should have been evicted")
	}
}
