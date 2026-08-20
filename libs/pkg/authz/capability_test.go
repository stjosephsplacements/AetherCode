package authz

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

const (
	testKeyID        = "018f4b0d-08f8-7c09-9ba7-efdf9c223344"
	testActorID      = "018f4b0d-08f8-7c09-9ba7-efdf9c223355"
	testTenant       = "018f4b0d-08f8-7c09-9ba7-efdf9c223366"
	testCapabilityID = "018f4b0d-08f8-7c09-9ba7-efdf9c223377"
)

func TestCapabilityRoundTripUsesDatabaseCanonicalEnvelope(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.July, 24, 10, 11, 12, 123456789, time.UTC)
	secret := strings.Repeat("a", 32)
	keyring, err := ParseKeyring(`[{"audience":"aether_submission","key_id":"` + testKeyID + `","secret_base64":"` + base64.StdEncoding.EncodeToString([]byte(secret)) + `"}]`)
	if err != nil {
		t.Fatalf("ParseKeyring() error = %v", err)
	}

	capability, err := keyring.Issue(
		"aether_submission", testActorID, testTenant, 42,
		testCapabilityID,
		"submission.answer.write", "attempt:018f4b0d-08f8-7c09-9ba7-efdf9c223377", now,
	)
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}
	wantCanonical := "aether-authz-context-v2|aether_submission|" + testKeyID + "|" + testCapabilityID + "|" + testActorID + "|" + testTenant + "|42|allow|submission.answer.write|attempt:018f4b0d-08f8-7c09-9ba7-efdf9c223377|2026-07-24T10:11:12.123456Z|2026-07-24T10:11:17.123456Z"
	if got := capability.CanonicalPayload(); got != wantCanonical {
		t.Fatalf("CanonicalPayload() = %q, want %q", got, wantCanonical)
	}

	encoded, err := capability.Encode()
	if err != nil {
		t.Fatalf("Encode() error = %v", err)
	}
	decoded, err := DecodeCapability(encoded, now.Add(time.Second))
	if err != nil {
		t.Fatalf("DecodeCapability() error = %v", err)
	}
	if got := decoded.CanonicalPayload(); got != wantCanonical {
		t.Fatalf("decoded CanonicalPayload() = %q, want %q", got, wantCanonical)
	}
	if string(decoded.Signature) != string(capability.Signature) {
		t.Fatal("decoded signature differs from issued signature")
	}
}

func TestDecodeCapabilityRejectsExpiredAndMalformedEnvelope(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.July, 24, 10, 11, 12, 0, time.UTC)
	keyring, err := ParseKeyring(`[{"audience":"aether_submission","key_id":"` + testKeyID + `","secret_base64":"` + base64.StdEncoding.EncodeToString([]byte(strings.Repeat("b", 32))) + `"}]`)
	if err != nil {
		t.Fatalf("ParseKeyring() error = %v", err)
	}
	capability, err := keyring.Issue("aether_submission", testActorID, testTenant, 1, testCapabilityID, "read", "attempt:one", now)
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}
	encoded, err := capability.Encode()
	if err != nil {
		t.Fatalf("Encode() error = %v", err)
	}
	if _, err := DecodeCapability(encoded, now.Add(6*time.Second)); err == nil {
		t.Fatal("DecodeCapability() accepted an expired capability")
	}
	if _, err := DecodeCapability("not-base64", now); err == nil {
		t.Fatal("DecodeCapability() accepted malformed base64")
	}
}

func TestCapabilityAllowsOnlyExplicitGlobalTenantScope(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.July, 24, 10, 11, 12, 0, time.UTC)
	keyring, err := ParseKeyring(`[{"audience":"aether_qbank","key_id":"` + testKeyID + `","secret_base64":"` + base64.StdEncoding.EncodeToString([]byte(strings.Repeat("c", 32))) + `"}]`)
	if err != nil {
		t.Fatalf("ParseKeyring() error = %v", err)
	}
	capability, err := keyring.Issue("aether_qbank", testActorID, "", 3, testCapabilityID, "question.read", "question:global", now)
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}
	if !strings.Contains(capability.CanonicalPayload(), "|"+testActorID+"||3|") {
		t.Fatalf("global canonical payload did not use an empty tenant field: %q", capability.CanonicalPayload())
	}
}
