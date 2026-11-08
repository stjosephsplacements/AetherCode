package app

import (
	"context"
	"testing"
)

type fakePublishedVersionStore struct{}

func (fakePublishedVersionStore) ResolvePublishedQuestionVersion(_ context.Context, _ string) (ResolvedQuestionVersion, error) {
	return ResolvedQuestionVersion{}, nil
}

func TestNewResolverRejectsNilStore(t *testing.T) {
	t.Parallel()
	_, err := NewResolver(nil)
	if err == nil {
		t.Fatal("NewResolver() accepted nil store")
	}
}

func TestNewResolverAcceptsValidStore(t *testing.T) {
	t.Parallel()
	_, err := NewResolver(fakePublishedVersionStore{})
	if err != nil {
		t.Fatalf("NewResolver() unexpected error: %v", err)
	}
}

func TestResolvePublishedQuestionVersionRejectsNonUUID(t *testing.T) {
	t.Parallel()
	resolver, _ := NewResolver(fakePublishedVersionStore{})
	_, err := resolver.ResolvePublishedQuestionVersion(context.Background(), "not-a-uuid")
	if err == nil {
		t.Fatal("ResolvePublishedQuestionVersion() accepted non-UUID input")
	}
}

func TestResolvePublishedQuestionVersionAcceptsValidUUID(t *testing.T) {
	t.Parallel()
	resolver, _ := NewResolver(fakePublishedVersionStore{})
	// The fake store returns zero value, so no error from the store itself.
	_, err := resolver.ResolvePublishedQuestionVersion(context.Background(), "018f4b0d-08f8-7c09-9ba7-efdf9c224001")
	if err != nil {
		t.Fatalf("ResolvePublishedQuestionVersion() unexpected error: %v", err)
	}
}

func TestResolvePublishedQuestionVersionNormalizesCase(t *testing.T) {
	t.Parallel()
	resolver, _ := NewResolver(fakePublishedVersionStore{})
	// Upper-case UUID should be normalized without error (lowercased before isUUID).
	_, err := resolver.ResolvePublishedQuestionVersion(context.Background(), "018F4B0D-08F8-7C09-9BA7-EFDF9C224001")
	if err != nil {
		t.Fatalf("ResolvePublishedQuestionVersion() rejected uppercase UUID: %v", err)
	}
}
