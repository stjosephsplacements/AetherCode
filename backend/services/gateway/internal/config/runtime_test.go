package config

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/url"
	"testing"
	"time"
)

func TestLoadRequiresVerifierInEveryEnvironment(t *testing.T) {
	t.Setenv(identityIssuerEnv, "")
	t.Setenv(identityAudienceEnv, "")
	t.Setenv(identityKeysEnv, "")
	t.Setenv(upstreamsEnv, `{"identity":"http://identity.internal"}`)
	if _, err := Load(); err == nil {
		t.Fatal("missing verifier must fail even outside production")
	}
}

func TestLoadAcceptsExplicitVerifierAndAbsoluteAllowlistedUpstream(t *testing.T) {
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	publicKey := privateKey.Public().(ed25519.PublicKey)
	encodedKeys, err := json.Marshal(map[string]string{"identity-2026": base64.StdEncoding.EncodeToString(publicKey)})
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv(identityIssuerEnv, "https://identity.aethercode.example")
	t.Setenv(identityAudienceEnv, "aethercode-platform")
	t.Setenv(identityKeysEnv, string(encodedKeys))
	t.Setenv(upstreamsEnv, `{"identity":"https://identity.internal/base","submission":"http://submission.internal"}`)
	t.Setenv("GATEWAY_TRUSTED_PROXY_CIDRS", `["10.0.0.0/8"]`)
	t.Setenv("GATEWAY_SEB_PROTECTED_PREFIXES", `[]`)

	runtime, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if runtime.Verifier == nil || runtime.Upstreams["identity"].String() != "https://identity.internal/base" || len(runtime.TrustedProxyCIDRs) != 1 {
		t.Fatalf("unexpected runtime: %+v", runtime)
	}
}

func TestParseUpstreamsRejectsJudgeAndQueryBearingURLs(t *testing.T) {
	if _, err := parseUpstreams(`{"judge":"http://judge.internal"}`); err == nil {
		t.Fatal("judge must never be a gateway upstream")
	}
	if _, err := parseUpstreams(`{"identity":"https://identity.internal?proxy=1"}`); err == nil {
		t.Fatal("query-bearing upstream must be rejected")
	}
	if _, err := parseUpstreams(`{"identity":"https://identity.internal"} not-json`); err == nil {
		t.Fatal("trailing malformed configuration must be rejected")
	}
}

func TestSEBProtectedPrefixesRequireSEBUpstream(t *testing.T) {
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	publicKey := privateKey.Public().(ed25519.PublicKey)
	encodedKeys, err := json.Marshal(map[string]string{"identity-2026": base64.StdEncoding.EncodeToString(publicKey)})
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv(identityIssuerEnv, "issuer")
	t.Setenv(identityAudienceEnv, "audience")
	t.Setenv(identityKeysEnv, string(encodedKeys))
	t.Setenv(upstreamsEnv, `{"submission":"http://submission.internal"}`)
	t.Setenv("GATEWAY_SEB_PROTECTED_PREFIXES", `["/api/submission/v1/exams"]`)
	if _, err := Load(); err == nil {
		t.Fatal("SEB enforcement without SEB upstream must fail startup")
	}
}

func TestParsePublicOrigin(t *testing.T) {
	for raw, valid := range map[string]bool{
		"https://exam.example.edu":      true,
		"http://127.0.0.1:8380":         true,
		"":                              false,
		"exam.example.edu":              false,
		"https://exam.example.edu/":     false,
		"https://exam.example.edu/api":  false,
		"https://exam.example.edu?x=1":  false,
		"https://user@exam.example.edu": false,
		"ftp://exam.example.edu":        false,
	} {
		if _, err := parsePublicOrigin(raw); (err == nil) != valid {
			t.Errorf("parsePublicOrigin(%q) error = %v, want valid %v", raw, err, valid)
		}
	}
}

func TestLoadRealtime(t *testing.T) {
	upstreams := map[string]*url.URL{"user": {Scheme: "http", Host: "user.internal"}, "analytics": {Scheme: "http", Host: "analytics.internal"}}
	t.Setenv("GATEWAY_REALTIME_ORIGINS", "https://exam.example.edu, http://localhost:3000")
	t.Setenv("GATEWAY_SERVICE_DESCRIPTIONS", `{"user":"Accounts, students and permissions"}`)
	realtime, err := loadRealtime(upstreams)
	if err != nil {
		t.Fatal(err)
	}
	if len(realtime.Origins) != 2 || realtime.Cookie != "ac_access" || realtime.HealthInterval != 5*time.Second || realtime.Descriptions["user"] == "" {
		t.Fatalf("unexpected realtime config: %+v", realtime)
	}

	for name, env := range map[string][2]string{
		"origin with a path":          {"GATEWAY_REALTIME_ORIGINS", "https://exam.example.edu/app"},
		"description of no upstream":  {"GATEWAY_SERVICE_DESCRIPTIONS", `{"billing":"Payments"}`},
		"health interval under a sec": {"GATEWAY_REALTIME_HEALTH_INTERVAL", "100ms"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv(env[0], env[1])
			if _, err := loadRealtime(upstreams); err == nil {
				t.Fatal("expected an error")
			}
		})
	}

	t.Setenv("GATEWAY_SERVICE_DESCRIPTIONS", "")
	if _, err := loadRealtime(map[string]*url.URL{"analytics": {Scheme: "http", Host: "analytics.internal"}}); err == nil {
		t.Fatal("realtime origins without a user upstream were accepted")
	}
}
