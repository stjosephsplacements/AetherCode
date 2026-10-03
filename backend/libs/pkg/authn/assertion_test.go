package authn

import (
	"crypto/ed25519"
	"crypto/rand"
	"reflect"
	"testing"
	"time"
)

const (
	testSubject = "018f4b0d-08f8-7c09-9ba7-efdf9c223355"
	testTokenID = "018f4b0d-08f8-7c09-9ba7-efdf9c223366"
)

func TestAssertionRoundTrip(t *testing.T) {
	t.Parallel()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey() error = %v", err)
	}
	signer, err := NewSigner("https://identity.aethercode.internal", "aethercode-api", "identity-2026-01", privateKey)
	if err != nil {
		t.Fatalf("NewSigner() error = %v", err)
	}
	now := time.Date(2026, time.July, 24, 10, 11, 12, 0, time.UTC)
	token, issuedClaims, err := signer.Issue(testSubject, testTokenID, now, 5*time.Minute)
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}
	verifier, err := NewVerifier("https://identity.aethercode.internal", "aethercode-api", map[string]ed25519.PublicKey{"identity-2026-01": publicKey}, 15*time.Minute, 5*time.Second)
	if err != nil {
		t.Fatalf("NewVerifier() error = %v", err)
	}
	claims, err := verifier.Verify(token, now.Add(time.Second))
	if err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
	if !reflect.DeepEqual(claims, issuedClaims) {
		t.Fatalf("Verify() claims = %#v, want %#v", claims, issuedClaims)
	}
}

func TestAssertionVerifierRejectsTamperingAndWrongAudience(t *testing.T) {
	t.Parallel()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey() error = %v", err)
	}
	signer, err := NewSigner("identity", "aethercode-api", "identity-2026-01", privateKey)
	if err != nil {
		t.Fatalf("NewSigner() error = %v", err)
	}
	now := time.Date(2026, time.July, 24, 10, 11, 12, 0, time.UTC)
	token, _, err := signer.Issue(testSubject, testTokenID, now, time.Minute)
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}
	verifier, err := NewVerifier("identity", "other-audience", map[string]ed25519.PublicKey{"identity-2026-01": publicKey}, 15*time.Minute, 0)
	if err != nil {
		t.Fatalf("NewVerifier() error = %v", err)
	}
	if _, err := verifier.Verify(token, now); err == nil {
		t.Fatal("Verify() accepted a token for the wrong audience")
	}

	lastCharacter := token[len(token)-1]
	replacement := byte('a')
	if lastCharacter == replacement {
		replacement = 'b'
	}
	tampered := token[:len(token)-1] + string(replacement)
	correctVerifier, err := NewVerifier("identity", "aethercode-api", map[string]ed25519.PublicKey{"identity-2026-01": publicKey}, 15*time.Minute, 0)
	if err != nil {
		t.Fatalf("NewVerifier() error = %v", err)
	}
	if _, err := correctVerifier.Verify(tampered, now); err == nil {
		t.Fatal("Verify() accepted a tampered token")
	}
}
