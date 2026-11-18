package app

import (
	"crypto/sha256"
	"sync"
	"time"

	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
)

// checkCache remembers allowed SEB request checks for a short time. At exam start every signed-in candidate sends a
// request every second or so, each with the same URL and hashes as the last, and every check costs a database
// transaction; reusing an allowed answer for a few seconds removes almost all of them. A policy change (an exam
// unlocked, its keys replaced) takes effect within the TTL. Denials and errors are never cached.
type checkCache struct {
	mu      sync.Mutex
	ttl     time.Duration
	entries map[[sha256.Size]byte]checkEntry
}

type checkEntry struct {
	result string
	until  time.Time
}

const maxCheckEntries = 200000

// SetCheckCacheTTL turns the cache on (ttl > 0) or off (0). Call it before serving requests.
func (service *Service) SetCheckCacheTTL(ttl time.Duration) {
	service.checkCache.mu.Lock()
	defer service.checkCache.mu.Unlock()
	service.checkCache.ttl = ttl
	service.checkCache.entries = make(map[[sha256.Size]byte]checkEntry)
}

func (service *Service) checkCacheKey(capability centralauthz.Capability, command CheckExamRequest) [sha256.Size]byte {
	hash := sha256.New()
	for _, part := range []string{capability.ActorID, command.TenantID, command.URL, command.RequestHash, command.ConfigKeyHash, command.ClientIP} {
		_, _ = hash.Write([]byte(part))
		_, _ = hash.Write([]byte{0})
	}
	var key [sha256.Size]byte
	copy(key[:], hash.Sum(nil))
	return key
}

func (cache *checkCache) get(key [sha256.Size]byte, now time.Time) (string, bool) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if cache.ttl <= 0 {
		return "", false
	}
	entry, ok := cache.entries[key]
	if !ok || !now.Before(entry.until) {
		return "", false
	}
	return entry.result, true
}

func (cache *checkCache) put(key [sha256.Size]byte, result string, now time.Time) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if cache.ttl <= 0 {
		return
	}
	if len(cache.entries) >= maxCheckEntries {
		for stored, entry := range cache.entries {
			if !now.Before(entry.until) {
				delete(cache.entries, stored)
			}
		}
		if len(cache.entries) >= maxCheckEntries {
			return
		}
	}
	cache.entries[key] = checkEntry{result: result, until: now.Add(cache.ttl)}
}
