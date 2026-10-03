package config

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"testing"
)

func TestLoadRequiresValidSigningKey(t *testing.T) {
	t.Setenv("IDENTITY_ACCESS_TOKEN_PRIVATE_KEY_BASE64", "not-base64")
	t.Setenv("IDENTITY_ACCESS_TOKEN_ISSUER", "identity")
	t.Setenv("IDENTITY_ACCESS_TOKEN_KEY_ID", "identity-2026-01")
	t.Setenv("IDENTITY_DELIVERY_TOKEN_HMAC_KEY_BASE64", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	t.Setenv("IDENTITY_MFA_MASTER_KEYS_JSON", `{"kms://identity/mfa/current":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}`)
	t.Setenv("IDENTITY_MFA_KEY_REFERENCE", "kms://identity/mfa/current")
	if _, err := Load("test"); err == nil {
		t.Fatal("Load() accepted an invalid signing key")
	}
}

func TestLoadAcceptsStrictRuntime(t *testing.T) {
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey() error = %v", err)
	}
	t.Setenv("IDENTITY_ACCESS_TOKEN_PRIVATE_KEY_BASE64", base64.StdEncoding.EncodeToString(privateKey))
	t.Setenv("IDENTITY_ACCESS_TOKEN_ISSUER", "identity")
	t.Setenv("IDENTITY_ACCESS_TOKEN_KEY_ID", "identity-2026-01")
	t.Setenv("IDENTITY_DELIVERY_TOKEN_HMAC_KEY_BASE64", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	t.Setenv("IDENTITY_MFA_MASTER_KEYS_JSON", `{"kms://identity/mfa/current":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}`)
	t.Setenv("IDENTITY_MFA_KEY_REFERENCE", "kms://identity/mfa/current")
	runtime, err := Load("test")
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if runtime.AccessSigner == nil || len(runtime.DeliveryTokenKey) != 32 || len(runtime.MFAMasterKeys) != 1 || runtime.MFAKeyReference == "" || !runtime.ExposeDevelopmentSecrets {
		t.Fatalf("Load() runtime = %#v", runtime)
	}
}
