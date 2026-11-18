package app

import (
	"testing"
	"time"

	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
)

func TestCheckCacheReusesAllowedAnswersOnlyForTheSameCandidateAndRequest(t *testing.T) {
	service := &Service{}
	now := time.Now()
	command := CheckExamRequest{TenantID: "t", URL: "https://x/api/a", RequestHash: "h", ConfigKeyHash: "c", ClientIP: "10.0.0.1"}
	candidate := centralauthz.Capability{ActorID: "student-1"}
	key := service.checkCacheKey(candidate, command)

	if _, ok := service.checkCache.get(key, now); ok {
		t.Fatal("a cache that was never turned on answered")
	}
	service.SetCheckCacheTTL(5 * time.Second)
	service.checkCache.put(key, "matched", now)
	if result, ok := service.checkCache.get(key, now.Add(4*time.Second)); !ok || result != "matched" {
		t.Fatalf("inside the TTL: %q %v", result, ok)
	}
	if _, ok := service.checkCache.get(key, now.Add(6*time.Second)); ok {
		t.Fatal("an answer outlived the TTL")
	}
	for name, other := range map[string]struct {
		capability centralauthz.Capability
		command    CheckExamRequest
	}{
		"another candidate":    {centralauthz.Capability{ActorID: "student-2"}, command},
		"another URL":          {candidate, CheckExamRequest{TenantID: "t", URL: "https://x/api/b", RequestHash: "h", ConfigKeyHash: "c", ClientIP: "10.0.0.1"}},
		"another request hash": {candidate, CheckExamRequest{TenantID: "t", URL: "https://x/api/a", RequestHash: "z", ConfigKeyHash: "c", ClientIP: "10.0.0.1"}},
		"another client IP":    {candidate, CheckExamRequest{TenantID: "t", URL: "https://x/api/a", RequestHash: "h", ConfigKeyHash: "c", ClientIP: "10.0.0.2"}},
	} {
		if _, ok := service.checkCache.get(service.checkCacheKey(other.capability, other.command), now); ok {
			t.Errorf("%s was served another request's answer", name)
		}
	}
}
