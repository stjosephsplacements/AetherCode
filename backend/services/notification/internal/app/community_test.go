package app

import (
	"context"
	"testing"

	"github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
)

func TestCommunityRejectsUnknownFunction(t *testing.T) {
	t.Parallel()
	_, err := (&Service{}).Community(context.Background(), authz.Capability{}, "unknown_function", testTenantID, nil)
	if err == nil {
		t.Fatal("Community accepted an unknown function name")
	}
}

func TestCommunityRejectsInvalidTenantUUID(t *testing.T) {
	t.Parallel()
	_, err := (&Service{}).Community(context.Background(), authz.Capability{}, "community_posts_list", "bad-uuid", nil)
	if err == nil {
		t.Fatal("Community accepted an invalid tenant UUID")
	}
}

func TestCommunityAcceptsAllKnownFunctions(t *testing.T) {
	t.Parallel()
	service := &Service{}
	for fn := range CommunityFunctions {
		t.Run(fn, func(t *testing.T) {
			t.Parallel()
			// Valid inputs pass function validation and fail only on nil pool.
			_, err := service.Community(context.Background(), authz.Capability{}, fn, testTenantID, nil)
			if err == nil {
				t.Fatalf("Community(%q) unexpectedly succeeded without a pool", fn)
			}
			// Must not be an invalid-argument error — only the nil pool should fail.
			if err.Error() == "community operation or tenant ID is invalid" {
				t.Fatalf("Community(%q) rejected a known function as unknown", fn)
			}
		})
	}
}
