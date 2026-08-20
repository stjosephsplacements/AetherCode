// Package config loads the gateway's deliberately small, explicit edge
// configuration. There is no discovery or development bypass: a gateway that
// cannot verify assertions or identify its upstreams must not start.
package config

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/authn"
)

const (
	identityIssuerEnv   = "GATEWAY_IDENTITY_ASSERTION_ISSUER"
	identityAudienceEnv = "GATEWAY_IDENTITY_ASSERTION_AUDIENCE"
	identityKeysEnv     = "GATEWAY_IDENTITY_ASSERTION_PUBLIC_KEYS"
	upstreamsEnv        = "GATEWAY_UPSTREAMS"
)

// PublicServices is the complete public service allow-list. Judge is
// deliberately absent: its control plane is never reachable through the edge.
var PublicServices = map[string]struct{}{
	"identity":      {},
	"tenant":        {},
	"user":          {},
	"question-bank": {},
	"assessment":    {},
	"submission":    {},
	"seb":           {},
	"notification":  {},
	"analytics":     {},
}

// Runtime is immutable after startup.
type Runtime struct {
	Upstreams            map[string]*url.URL
	Verifier             *authn.Verifier
	TrustedProxyCIDRs    []*net.IPNet
	SEBProtectedPrefixes []string
	RateLimit            RateLimit
	RequestTimeout       time.Duration
	SEBValidationTimeout time.Duration
}

// RateLimit bounds local memory and protects an individual gateway instance.
// Deployment-wide quotas are intentionally enforced at the ingress layer.
type RateLimit struct {
	Capacity        float64
	RefillPerSecond float64
	MaxEntries      int
	IdleTTL         time.Duration
}

// Load reads all gateway settings. Every environment validates the verifier
// and at least one upstream so a local run cannot accidentally become an
// authentication bypass.
func Load() (Runtime, error) {
	issuer, err := required(identityIssuerEnv)
	if err != nil {
		return Runtime{}, err
	}
	audience, err := required(identityAudienceEnv)
	if err != nil {
		return Runtime{}, err
	}
	rawKeys, err := required(identityKeysEnv)
	if err != nil {
		return Runtime{}, err
	}
	verifier, err := parseVerifier(issuer, audience, rawKeys)
	if err != nil {
		return Runtime{}, err
	}
	rawUpstreams, err := required(upstreamsEnv)
	if err != nil {
		return Runtime{}, err
	}
	upstreams, err := parseUpstreams(rawUpstreams)
	if err != nil {
		return Runtime{}, err
	}
	trustedProxyCIDRs, err := parseCIDRs(optional("GATEWAY_TRUSTED_PROXY_CIDRS", "[]"))
	if err != nil {
		return Runtime{}, err
	}
	prefixes, err := parseSEBProtectedPrefixes(optional("GATEWAY_SEB_PROTECTED_PREFIXES", "[]"))
	if err != nil {
		return Runtime{}, err
	}
	if len(prefixes) > 0 {
		if _, ok := upstreams["seb"]; !ok {
			return Runtime{}, fmt.Errorf("GATEWAY_SEB_PROTECTED_PREFIXES requires a seb upstream")
		}
	}
	rateLimit, err := loadRateLimit()
	if err != nil {
		return Runtime{}, err
	}
	requestTimeout, err := duration("GATEWAY_REQUEST_TIMEOUT", 30*time.Second)
	if err != nil {
		return Runtime{}, err
	}
	sebValidationTimeout, err := duration("GATEWAY_SEB_VALIDATION_TIMEOUT", 3*time.Second)
	if err != nil {
		return Runtime{}, err
	}
	if requestTimeout <= 0 || sebValidationTimeout <= 0 {
		return Runtime{}, fmt.Errorf("gateway request timeouts must be positive")
	}
	return Runtime{
		Upstreams:            upstreams,
		Verifier:             verifier,
		TrustedProxyCIDRs:    trustedProxyCIDRs,
		SEBProtectedPrefixes: prefixes,
		RateLimit:            rateLimit,
		RequestTimeout:       requestTimeout,
		SEBValidationTimeout: sebValidationTimeout,
	}, nil
}

func required(name string) (string, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return "", fmt.Errorf("%s is required", name)
	}
	return value, nil
}

func optional(name, fallback string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	return value
}

func parseVerifier(issuer, audience, rawKeys string) (*authn.Verifier, error) {
	keys := make(map[string]string)
	if err := strictJSONObject(rawKeys, &keys); err != nil {
		return nil, fmt.Errorf("parse %s: %w", identityKeysEnv, err)
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("%s must contain at least one key", identityKeysEnv)
	}
	parsed := make(map[string]ed25519.PublicKey, len(keys))
	for keyID, encoded := range keys {
		keyID = strings.TrimSpace(keyID)
		if keyID == "" || strings.TrimSpace(encoded) == "" {
			return nil, fmt.Errorf("%s contains an empty key ID or value", identityKeysEnv)
		}
		key, err := authn.ParsePublicKey(encoded)
		if err != nil {
			return nil, fmt.Errorf("parse identity assertion key %q: %w", keyID, err)
		}
		parsed[keyID] = key
	}
	verifier, err := authn.NewVerifier(issuer, audience, parsed, 15*time.Minute, 5*time.Second)
	if err != nil {
		return nil, fmt.Errorf("configure identity assertion verifier: %w", err)
	}
	return verifier, nil
}

func parseUpstreams(raw string) (map[string]*url.URL, error) {
	configured := make(map[string]string)
	if err := strictJSONObject(raw, &configured); err != nil {
		return nil, fmt.Errorf("parse %s: %w", upstreamsEnv, err)
	}
	if len(configured) == 0 {
		return nil, fmt.Errorf("%s must contain at least one upstream", upstreamsEnv)
	}
	result := make(map[string]*url.URL, len(configured))
	for service, rawURL := range configured {
		if _, allowed := PublicServices[service]; !allowed {
			return nil, fmt.Errorf("%s has unsupported service %q", upstreamsEnv, service)
		}
		parsed, err := url.Parse(strings.TrimSpace(rawURL))
		if err != nil || !parsed.IsAbs() || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || parsed.Opaque != "" {
			return nil, fmt.Errorf("%s[%q] must be an absolute HTTP(S) URL without credentials, query, or fragment", upstreamsEnv, service)
		}
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			return nil, fmt.Errorf("%s[%q] must use http or https", upstreamsEnv, service)
		}
		if parsed.Path == "" {
			parsed.Path = "/"
		}
		if strings.Contains(parsed.Path, "..") || path.Clean(parsed.Path) == "." {
			return nil, fmt.Errorf("%s[%q] contains an unsafe path", upstreamsEnv, service)
		}
		result[service] = parsed
	}
	return result, nil
}

func parseCIDRs(raw string) ([]*net.IPNet, error) {
	var values []string
	if err := strictJSONArray(raw, &values); err != nil {
		return nil, fmt.Errorf("parse GATEWAY_TRUSTED_PROXY_CIDRS: %w", err)
	}
	result := make([]*net.IPNet, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			return nil, fmt.Errorf("GATEWAY_TRUSTED_PROXY_CIDRS contains an empty CIDR")
		}
		if _, exists := seen[value]; exists {
			return nil, fmt.Errorf("GATEWAY_TRUSTED_PROXY_CIDRS contains duplicate CIDR %q", value)
		}
		_, parsed, err := net.ParseCIDR(value)
		if err != nil {
			return nil, fmt.Errorf("parse trusted proxy CIDR %q: %w", value, err)
		}
		seen[value] = struct{}{}
		result = append(result, parsed)
	}
	return result, nil
}

func parseSEBProtectedPrefixes(raw string) ([]string, error) {
	var values []string
	if err := strictJSONArray(raw, &values); err != nil {
		return nil, fmt.Errorf("parse GATEWAY_SEB_PROTECTED_PREFIXES: %w", err)
	}
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || !strings.HasPrefix(value, "/api/") || strings.Contains(value, "?") || strings.Contains(value, "#") || strings.Contains(value, "//") || strings.Contains(value, "%") {
			return nil, fmt.Errorf("invalid SEB-protected prefix %q", value)
		}
		segments := strings.Split(strings.TrimPrefix(value, "/api/"), "/")
		if len(segments) == 0 || segments[0] == "" {
			return nil, fmt.Errorf("invalid SEB-protected prefix %q", value)
		}
		if _, allowed := PublicServices[segments[0]]; !allowed {
			return nil, fmt.Errorf("SEB-protected prefix %q names an unsupported service", value)
		}
		if strings.Contains(value, "..") {
			return nil, fmt.Errorf("invalid SEB-protected prefix %q", value)
		}
		value = strings.TrimSuffix(value, "/")
		if _, exists := seen[value]; exists {
			return nil, fmt.Errorf("duplicate SEB-protected prefix %q", value)
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result, nil
}

func loadRateLimit() (RateLimit, error) {
	capacity, err := positiveFloat("GATEWAY_RATE_LIMIT_CAPACITY", 60)
	if err != nil {
		return RateLimit{}, err
	}
	refill, err := positiveFloat("GATEWAY_RATE_LIMIT_REFILL_PER_SECOND", 10)
	if err != nil {
		return RateLimit{}, err
	}
	maxEntries, err := positiveInt("GATEWAY_RATE_LIMIT_MAX_ENTRIES", 100000)
	if err != nil {
		return RateLimit{}, err
	}
	if maxEntries > 1000000 {
		return RateLimit{}, fmt.Errorf("GATEWAY_RATE_LIMIT_MAX_ENTRIES exceeds the 1000000 safety bound")
	}
	idleTTL, err := duration("GATEWAY_RATE_LIMIT_IDLE_TTL", 10*time.Minute)
	if err != nil {
		return RateLimit{}, err
	}
	if idleTTL <= 0 {
		return RateLimit{}, fmt.Errorf("GATEWAY_RATE_LIMIT_IDLE_TTL must be positive")
	}
	return RateLimit{Capacity: capacity, RefillPerSecond: refill, MaxEntries: maxEntries, IdleTTL: idleTTL}, nil
}

func positiveFloat(name string, fallback float64) (float64, error) {
	value := optional(name, strconv.FormatFloat(fallback, 'f', -1, 64))
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive number", name)
	}
	return parsed, nil
}

func positiveInt(name string, fallback int) (int, error) {
	value := optional(name, strconv.Itoa(fallback))
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", name)
	}
	return parsed, nil
}

func duration(name string, fallback time.Duration) (time.Duration, error) {
	value := optional(name, fallback.String())
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("%s must be a duration: %w", name, err)
	}
	return parsed, nil
}

func strictJSONObject(raw string, target any) error {
	decoder := json.NewDecoder(bytes.NewBufferString(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if decoder.More() {
		return fmt.Errorf("unexpected trailing JSON value")
	}
	var extra any
	err := decoder.Decode(&extra)
	if errors.Is(err, io.EOF) {
		return nil
	}
	if err == nil {
		return fmt.Errorf("unexpected trailing JSON value")
	}
	return fmt.Errorf("invalid trailing JSON: %w", err)
}

func strictJSONArray(raw string, target any) error {
	return strictJSONObject(raw, target)
}
