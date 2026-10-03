package authn

import (
	"crypto/ed25519"
	"testing"
	"time"
)

func TestUnverifiedSubjectExtractsOnlySyntacticSubject(t *testing.T) {
	t.Parallel()
	privateKey := ed25519.NewKeyFromSeed(make([]byte, ed25519.SeedSize))
	signer, err := NewSigner("identity", "aethercode-api", "identity-test", privateKey)
	if err != nil {
		t.Fatalf("NewSigner() error = %v", err)
	}
	token, _, err := signer.Issue("019b11a0-0000-7000-8000-000000000001", "019b11a0-0000-7000-8000-000000000002", time.Now(), time.Minute)
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}
	subject, err := UnverifiedSubject(token)
	if err != nil || subject != "019b11a0-0000-7000-8000-000000000001" {
		t.Fatalf("UnverifiedSubject() = %q, %v", subject, err)
	}
}
