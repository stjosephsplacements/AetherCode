package domain

import (
	"encoding/base32"
	"testing"
	"time"
)

func TestProtectMFASecretRoundTrip(t *testing.T) {
	t.Parallel()
	masterKey := make([]byte, 32)
	for index := range masterKey {
		masterKey[index] = byte(index + 1)
	}
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString([]byte("01234567890123456789"))
	protected, err := ProtectMFASecret(masterKey, secret)
	if err != nil {
		t.Fatalf("ProtectMFASecret() error = %v", err)
	}
	if string(protected.Ciphertext) == secret || len(protected.EncryptedDataKey) == 0 {
		t.Fatal("MFA secret was not envelope encrypted")
	}
	actual, err := UnprotectMFASecret(masterKey, protected)
	if err != nil || actual != secret {
		t.Fatalf("UnprotectMFASecret() = %q, %v", actual, err)
	}
}

func TestValidateTOTPKnownRFC6238Vector(t *testing.T) {
	t.Parallel()
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString([]byte("12345678901234567890"))
	if !ValidateTOTP(secret, "287082", time.Unix(59, 0).UTC()) {
		t.Fatal("ValidateTOTP() rejected RFC 6238 6-digit vector")
	}
	if ValidateTOTP(secret, "000000", time.Unix(59, 0).UTC()) {
		t.Fatal("ValidateTOTP() accepted an invalid code")
	}
}
