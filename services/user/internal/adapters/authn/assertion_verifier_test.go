package authn

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"testing"
	"time"

	sharedauthn "github.com/aethercode/aethercode/libs/pkg/authn"
)

type fakeSessionValidator struct{ err error }

func (validator fakeSessionValidator) Validate(context.Context, string) error { return validator.err }

const (
	adapterTestPrincipal = "018f4b0d-08f8-7c09-9ba7-efdf9c223355"
	adapterTestRequestID = "018f4b0d-08f8-7c09-9ba7-efdf9c223366"
)

func TestAssertionVerifierReturnsOnlyVerifiedIdentityBinding(t *testing.T) {
	t.Parallel()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey() error = %v", err)
	}
	signer, err := sharedauthn.NewSigner("identity", "aethercode-authz", "identity-2026-01", privateKey)
	if err != nil {
		t.Fatalf("NewSigner() error = %v", err)
	}
	sharedVerifier, err := sharedauthn.NewVerifier(
		"identity", "aethercode-authz", map[string]ed25519.PublicKey{"identity-2026-01": publicKey}, 15*time.Minute, 5*time.Second,
	)
	if err != nil {
		t.Fatalf("NewVerifier() error = %v", err)
	}
	verifier, err := NewAssertionVerifier(sharedVerifier, fakeSessionValidator{})
	if err != nil {
		t.Fatalf("NewAssertionVerifier() error = %v", err)
	}
	assertion, _, err := signer.Issue(adapterTestPrincipal, adapterTestRequestID, time.Now(), time.Minute)
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}

	identity, err := verifier.Verify(context.Background(), assertion)
	if err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
	if identity.PrincipalID != adapterTestPrincipal {
		t.Fatalf("Verify() identity = %#v", identity)
	}
}

func TestAssertionVerifierHonorsCanceledContext(t *testing.T) {
	t.Parallel()
	contextValue, cancel := context.WithCancel(context.Background())
	cancel()
	verifier := &AssertionVerifier{}
	_, err := verifier.Verify(contextValue, "unused")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Verify() error = %v, want context.Canceled", err)
	}
}
