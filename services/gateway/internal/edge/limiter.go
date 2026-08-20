package edge

import (
	"fmt"
	"sync"
	"time"
)

// RateLimitConfig describes an in-process token bucket set. It is deliberately
// bounded: a malicious stream of principals/IPs cannot grow the gateway heap
// without limit.
type RateLimitConfig struct {
	Capacity        float64
	RefillPerSecond float64
	MaxEntries      int
	IdleTTL         time.Duration
}

type tokenBucket struct {
	tokens   float64
	updated  time.Time
	lastSeen time.Time
}

// Limiter is safe for concurrent HTTP handlers.
type Limiter struct {
	mu      sync.Mutex
	config  RateLimitConfig
	buckets map[string]tokenBucket
}

func NewLimiter(config RateLimitConfig) (*Limiter, error) {
	if config.Capacity <= 0 || config.RefillPerSecond <= 0 || config.MaxEntries <= 0 || config.IdleTTL <= 0 {
		return nil, fmt.Errorf("token bucket configuration must be positive")
	}
	return &Limiter{config: config, buckets: make(map[string]tokenBucket)}, nil
}

// Allow consumes one token. Eviction happens under the same lock as admission,
// so the configured entry cap is invariant even under concurrent requests.
func (limiter *Limiter) Allow(key string, now time.Time) bool {
	if limiter == nil || key == "" {
		return false
	}
	limiter.mu.Lock()
	defer limiter.mu.Unlock()

	if bucket, exists := limiter.buckets[key]; exists {
		bucket = limiter.refill(bucket, now)
		bucket.lastSeen = now
		if bucket.tokens < 1 {
			limiter.buckets[key] = bucket
			return false
		}
		bucket.tokens--
		limiter.buckets[key] = bucket
		return true
	}

	limiter.evictIdle(now)
	if len(limiter.buckets) >= limiter.config.MaxEntries {
		limiter.evictOldest()
	}
	if len(limiter.buckets) >= limiter.config.MaxEntries {
		return false
	}
	limiter.buckets[key] = tokenBucket{
		tokens:   limiter.config.Capacity - 1,
		updated:  now,
		lastSeen: now,
	}
	return true
}

func (limiter *Limiter) refill(bucket tokenBucket, now time.Time) tokenBucket {
	if now.Before(bucket.updated) {
		return bucket
	}
	bucket.tokens += now.Sub(bucket.updated).Seconds() * limiter.config.RefillPerSecond
	if bucket.tokens > limiter.config.Capacity {
		bucket.tokens = limiter.config.Capacity
	}
	bucket.updated = now
	return bucket
}

func (limiter *Limiter) evictIdle(now time.Time) {
	for key, bucket := range limiter.buckets {
		if !now.Before(bucket.lastSeen.Add(limiter.config.IdleTTL)) {
			delete(limiter.buckets, key)
		}
	}
}

func (limiter *Limiter) evictOldest() {
	var (
		oldestKey string
		oldest    time.Time
	)
	for key, bucket := range limiter.buckets {
		if oldestKey == "" || bucket.lastSeen.Before(oldest) {
			oldestKey = key
			oldest = bucket.lastSeen
		}
	}
	if oldestKey != "" {
		delete(limiter.buckets, oldestKey)
	}
}
