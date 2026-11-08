package domain

import (
	"strings"
	"testing"
)

func TestNewOpaqueTokenProducesUniqueValues(t *testing.T) {
	t.Parallel()
	a, err := NewOpaqueToken()
	if err != nil {
		t.Fatalf("NewOpaqueToken() error = %v", err)
	}
	b, err := NewOpaqueToken()
	if err != nil {
		t.Fatalf("NewOpaqueToken() error = %v", err)
	}
	if a == b {
		t.Fatal("NewOpaqueToken() produced the same value twice")
	}
	if len(a) < 40 {
		t.Fatalf("NewOpaqueToken() too short: %d chars", len(a))
	}
}

func TestHashTokenIsDeterministic(t *testing.T) {
	t.Parallel()
	const tok = "test-token"
	a, b := HashToken(tok), HashToken(tok)
	if a != b {
		t.Fatal("HashToken() is not deterministic")
	}
}

func TestHashTokenDiffersForDifferentInputs(t *testing.T) {
	t.Parallel()
	if HashToken("a") == HashToken("b") {
		t.Fatal("HashToken() returned the same hash for different inputs")
	}
}

func TestDeriveDeliveryTokenRejectsTooShortKey(t *testing.T) {
	t.Parallel()
	_, err := DeriveDeliveryToken(make([]byte, 31), "email-verification", "018f4b0d-08f8-7c09-9ba7-efdf9c220001")
	if err == nil {
		t.Fatal("DeriveDeliveryToken() accepted a key shorter than 32 bytes")
	}
}

func TestDeriveDeliveryTokenRejectsInvalidPurpose(t *testing.T) {
	t.Parallel()
	_, err := DeriveDeliveryToken(make([]byte, 32), "login", "018f4b0d-08f8-7c09-9ba7-efdf9c220001")
	if err == nil {
		t.Fatal("DeriveDeliveryToken() accepted an unknown purpose")
	}
}

func TestDeriveDeliveryTokenRejectsNonUUIDTokenID(t *testing.T) {
	t.Parallel()
	_, err := DeriveDeliveryToken(make([]byte, 32), "password-reset", "not-a-uuid")
	if err == nil {
		t.Fatal("DeriveDeliveryToken() accepted a non-UUID token ID")
	}
}

func TestDeriveDeliveryTokenIsDeterministic(t *testing.T) {
	t.Parallel()
	key := make([]byte, 32)
	const purpose = "email-verification"
	const tokenID = "018f4b0d-08f8-7c09-9ba7-efdf9c220001"
	a, err := DeriveDeliveryToken(key, purpose, tokenID)
	if err != nil {
		t.Fatalf("DeriveDeliveryToken() error = %v", err)
	}
	b, err := DeriveDeliveryToken(key, purpose, tokenID)
	if err != nil {
		t.Fatalf("DeriveDeliveryToken() error = %v", err)
	}
	if a != b {
		t.Fatalf("DeriveDeliveryToken() is not deterministic: %q != %q", a, b)
	}
}

func TestDeriveDeliveryTokenFormatStartsWithAdt1(t *testing.T) {
	t.Parallel()
	key := make([]byte, 32)
	token, err := DeriveDeliveryToken(key, "password-reset", "018f4b0d-08f8-7c09-9ba7-efdf9c220001")
	if err != nil {
		t.Fatalf("DeriveDeliveryToken() error = %v", err)
	}
	if !strings.HasPrefix(token, "adt1.password-reset.") {
		t.Fatalf("DeriveDeliveryToken() format unexpected: %q", token)
	}
}

func TestDeriveDeliveryTokenDiffersAcrossPurposes(t *testing.T) {
	t.Parallel()
	key := make([]byte, 32)
	const tokenID = "018f4b0d-08f8-7c09-9ba7-efdf9c220001"
	a, _ := DeriveDeliveryToken(key, "email-verification", tokenID)
	b, _ := DeriveDeliveryToken(key, "password-reset", tokenID)
	if a == b {
		t.Fatal("DeriveDeliveryToken() produced the same token for different purposes")
	}
}

func TestDeriveDeliveryTokenDiffersAcrossKeys(t *testing.T) {
	t.Parallel()
	key1 := make([]byte, 32)
	key2 := make([]byte, 32)
	key2[0] = 1
	const purpose = "email-verification"
	const tokenID = "018f4b0d-08f8-7c09-9ba7-efdf9c220001"
	a, _ := DeriveDeliveryToken(key1, purpose, tokenID)
	b, _ := DeriveDeliveryToken(key2, purpose, tokenID)
	if a == b {
		t.Fatal("DeriveDeliveryToken() produced the same token for different keys")
	}
}

func TestDeriveDeliveryTokenAcceptsBothValidPurposes(t *testing.T) {
	t.Parallel()
	key := make([]byte, 32)
	const tokenID = "018f4b0d-08f8-7c09-9ba7-efdf9c220001"
	for _, purpose := range []string{"email-verification", "password-reset"} {
		_, err := DeriveDeliveryToken(key, purpose, tokenID)
		if err != nil {
			t.Fatalf("DeriveDeliveryToken(%q) unexpected error: %v", purpose, err)
		}
	}
}
