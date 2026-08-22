package httpadapter

import (
	"fmt"
	"sync"
	"time"
)

// RegisterLimiterConfig describes the per-IP token bucket used to throttle
// POST /v1/auth/register. MaxEntries bounds heap growth so a flood of distinct
// source addresses cannot exhaust process memory.
type RegisterLimiterConfig struct {
	Capacity        float64
	RefillPerSecond float64
	MaxEntries      int
	IdleTTL         time.Duration
}

type bucket struct {
	tokens   float64
	updated  time.Time
	lastSeen time.Time
}

// RegisterLimiter rate-limits registration attempts per client IP address.
// It is safe for concurrent HTTP handlers.
type RegisterLimiter struct {
	mu      sync.Mutex
	config  RegisterLimiterConfig
	buckets map[string]bucket
}

// NewRegisterLimiter constructs a limiter from the supplied config.
func NewRegisterLimiter(config RegisterLimiterConfig) (*RegisterLimiter, error) {
	if config.Capacity <= 0 || config.RefillPerSecond <= 0 || config.MaxEntries <= 0 || config.IdleTTL <= 0 {
		return nil, fmt.Errorf("register limiter configuration must be positive")
	}
	return &RegisterLimiter{config: config, buckets: make(map[string]bucket)}, nil
}

// Allow consumes one token for key and returns true when the request is within
// the allowed rate. Eviction runs under the same lock as admission so MaxEntries
// is invariant under concurrent load. A nil limiter or empty key returns false.
func (limiter *RegisterLimiter) Allow(key string, now time.Time) bool {
	if limiter == nil || key == "" {
		return false
	}
	limiter.mu.Lock()
	defer limiter.mu.Unlock()

	if b, exists := limiter.buckets[key]; exists {
		b = limiter.refill(b, now)
		b.lastSeen = now
		if b.tokens < 1 {
			limiter.buckets[key] = b
			return false
		}
		b.tokens--
		limiter.buckets[key] = b
		return true
	}

	limiter.evictIdle(now)
	if len(limiter.buckets) >= limiter.config.MaxEntries {
		limiter.evictOldest()
	}
	if len(limiter.buckets) >= limiter.config.MaxEntries {
		return false
	}
	limiter.buckets[key] = bucket{
		tokens:   limiter.config.Capacity - 1,
		updated:  now,
		lastSeen: now,
	}
	return true
}

func (limiter *RegisterLimiter) refill(b bucket, now time.Time) bucket {
	if now.Before(b.updated) {
		return b
	}
	b.tokens += now.Sub(b.updated).Seconds() * limiter.config.RefillPerSecond
	if b.tokens > limiter.config.Capacity {
		b.tokens = limiter.config.Capacity
	}
	b.updated = now
	return b
}

func (limiter *RegisterLimiter) evictIdle(now time.Time) {
	for key, b := range limiter.buckets {
		if !now.Before(b.lastSeen.Add(limiter.config.IdleTTL)) {
			delete(limiter.buckets, key)
		}
	}
}

func (limiter *RegisterLimiter) evictOldest() {
	var (
		oldestKey string
		oldest    time.Time
	)
	for key, b := range limiter.buckets {
		if oldestKey == "" || b.lastSeen.Before(oldest) {
			oldestKey = key
			oldest = b.lastSeen
		}
	}
	if oldestKey != "" {
		delete(limiter.buckets, oldestKey)
	}
}
