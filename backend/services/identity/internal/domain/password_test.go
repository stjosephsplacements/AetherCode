package domain

import (
	"strings"
	"testing"
)

func TestHashAndVerifyPassword(t *testing.T) {
	t.Parallel()
	hash, err := HashPassword("AetherCode2026")
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	if !VerifyPassword(hash, "AetherCode2026") {
		t.Fatal("VerifyPassword() rejected its own hash")
	}
	if VerifyPassword(hash, "wrong-password") {
		t.Fatal("VerifyPassword() accepted a wrong password")
	}
}

func TestValidatePassword(t *testing.T) {
	t.Parallel()
	for _, password := range []string{"short1", "onlyletterslong"} {
		if err := ValidatePassword(password); err == nil {
			t.Fatalf("ValidatePassword(%q) accepted an invalid password", password)
		}
	}
}

func TestDeriveDeliveryTokenIsPurposeBoundAndStable(t *testing.T) {
	t.Parallel()
	key := make([]byte, 32)
	for index := range key {
		key[index] = byte(index + 1)
	}
	verification, err := DeriveDeliveryToken(key, "email-verification", "019b11a0-0000-7000-8000-000000000001")
	if err != nil {
		t.Fatalf("DeriveDeliveryToken() error = %v", err)
	}
	again, err := DeriveDeliveryToken(key, "email-verification", "019b11a0-0000-7000-8000-000000000001")
	if err != nil || verification != again {
		t.Fatalf("delivery token derivation was not stable: %q / %q / %v", verification, again, err)
	}
	reset, err := DeriveDeliveryToken(key, "password-reset", "019b11a0-0000-7000-8000-000000000001")
	if err != nil || reset == verification {
		t.Fatalf("delivery token purpose binding failed: %q / %q / %v", verification, reset, err)
	}
}

func TestGeneratePasswordSatisfiesPolicy(t *testing.T) {
	t.Parallel()
	seen := map[string]bool{}
	for range 200 {
		password, err := GeneratePassword()
		if err != nil {
			t.Fatalf("GeneratePassword() error = %v", err)
		}
		if err := ValidatePassword(password); err != nil {
			t.Fatalf("GeneratePassword() = %q violates policy: %v", password, err)
		}
		if strings.ContainsAny(password, "0O1lI") {
			t.Fatalf("GeneratePassword() = %q contains an ambiguous character", password)
		}
		seen[password] = true
	}
	if len(seen) != 200 {
		t.Fatalf("GeneratePassword() repeated a password in 200 draws")
	}
}
