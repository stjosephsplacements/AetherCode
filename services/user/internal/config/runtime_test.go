package config

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestLoadRequiresKeyringAndProductionMTLS(t *testing.T) {
	t.Setenv("AUTHZ_CAPABILITY_KEYS", `[{"audience":"aether_submission","key_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223344","secret_base64":"`+base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32)))+`"}]`)
	t.Setenv("AUTHZ_TLS_CERT_FILE", "")
	t.Setenv("AUTHZ_TLS_KEY_FILE", "")
	t.Setenv("AUTHZ_CLIENT_CA_FILE", "")
	t.Setenv("AUTHZ_MTLS_SERVICE_TARGETS", "")
	setIdentityAssertionVerifierEnv(t)
	if _, err := Load("production"); err == nil {
		t.Fatal("Load(production) accepted missing mTLS configuration")
	}

	runtime, err := Load("development")
	if err != nil {
		t.Fatalf("Load(development) error = %v", err)
	}
	if runtime.Keyring == nil || runtime.GRPCAddress != ":9443" {
		t.Fatalf("Load(development) = %#v", runtime)
	}
}

func TestLoadRejectsMissingKeyring(t *testing.T) {
	t.Setenv("AUTHZ_CAPABILITY_KEYS", "")
	if _, err := Load("development"); err == nil {
		t.Fatal("Load() accepted an empty authorization capability keyring")
	}
}

func TestLoadRequiresVerifiedSPIFFECallerTargetMapWhenMTLSEnabled(t *testing.T) {
	t.Setenv("AUTHZ_CAPABILITY_KEYS", `[{"audience":"aether_submission","key_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223344","secret_base64":"`+base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32)))+`"}]`)
	t.Setenv("AUTHZ_TLS_CERT_FILE", "/tls/tls.crt")
	t.Setenv("AUTHZ_TLS_KEY_FILE", "/tls/tls.key")
	t.Setenv("AUTHZ_CLIENT_CA_FILE", "/tls/ca.crt")
	t.Setenv("AUTHZ_MTLS_SERVICE_TARGETS", "")

	if _, err := Load("production"); err == nil {
		t.Fatal("Load(production) accepted an empty SPIFFE caller map")
	}

	t.Setenv("AUTHZ_MTLS_SERVICE_TARGETS", `{"https://identity.example/service":"submission"}`)
	if _, err := Load("production"); err == nil {
		t.Fatal("Load(production) accepted a non-SPIFFE caller identity")
	}

	t.Setenv("AUTHZ_MTLS_SERVICE_TARGETS", `{"spiffe://aethercode.local/ns/platform/sa/submission":"submission"}`)
	if _, err := Load("production"); err == nil {
		t.Fatal("Load(production) accepted missing identity assertion verifier configuration")
	}
	setIdentityAssertionVerifierEnv(t)
	t.Setenv("AUTHZ_IDENTITY_INTROSPECTION_URL", "https://identity.internal:9444")
	t.Setenv("AUTHZ_IDENTITY_INTROSPECTION_TLS_CERT_FILE", "/tls/tls.crt")
	t.Setenv("AUTHZ_IDENTITY_INTROSPECTION_TLS_KEY_FILE", "/tls/tls.key")
	t.Setenv("AUTHZ_IDENTITY_INTROSPECTION_TLS_CA_FILE", "/tls/ca.crt")
	runtime, err := Load("production")
	if err != nil {
		t.Fatalf("Load(production) error = %v", err)
	}
	if got := runtime.TrustedServiceTargets["spiffe://aethercode.local/ns/platform/sa/submission"]; got != "submission" {
		t.Fatalf("trusted service target = %q, want submission", got)
	}
	if runtime.IdentityAssertionVerifier == nil {
		t.Fatal("Load(production) did not configure the identity assertion verifier")
	}
}

func TestLoadRejectsMalformedIdentityAssertionPublicKey(t *testing.T) {
	t.Setenv("AUTHZ_CAPABILITY_KEYS", `[{
"audience":"aether_submission","key_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223344","secret_base64":"`+base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32)))+`"}]`)
	t.Setenv("AUTHZ_TLS_CERT_FILE", "/tls/tls.crt")
	t.Setenv("AUTHZ_TLS_KEY_FILE", "/tls/tls.key")
	t.Setenv("AUTHZ_CLIENT_CA_FILE", "/tls/ca.crt")
	t.Setenv("AUTHZ_MTLS_SERVICE_TARGETS", `{"spiffe://aethercode.local/ns/platform/sa/submission":"submission"}`)
	t.Setenv("AUTHZ_IDENTITY_ASSERTION_ISSUER", "identity")
	t.Setenv("AUTHZ_IDENTITY_ASSERTION_AUDIENCE", "aethercode-authz")
	t.Setenv("AUTHZ_IDENTITY_ASSERTION_PUBLIC_KEYS", `{"identity-2026-01":"not-a-key"}`)

	if _, err := Load("production"); err == nil {
		t.Fatal("Load(production) accepted a malformed identity assertion public key")
	}
}

func setIdentityAssertionVerifierEnv(t *testing.T) {
	t.Helper()
	t.Setenv("AUTHZ_IDENTITY_ASSERTION_ISSUER", "identity")
	t.Setenv("AUTHZ_IDENTITY_ASSERTION_AUDIENCE", "aethercode-authz")
	t.Setenv("AUTHZ_IDENTITY_ASSERTION_PUBLIC_KEYS", `{"identity-2026-01":"`+base64.StdEncoding.EncodeToString([]byte(strings.Repeat("p", 32)))+`"}`)
}
