// Package config validates the User authorization server's internal runtime
// configuration.
package config

import (
	"crypto/ed25519"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/authn"
	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
)

// Runtime controls the canonical authorization gRPC listener and its signing
// keyring. Production and staging always require verified TLS 1.3 client
// certificates.
type Runtime struct {
	GRPCAddress               string
	CertificateFile           string
	KeyFile                   string
	ClientCAFile              string
	TrustedServiceTargets     map[string]string
	IdentityAssertionVerifier *authn.Verifier
	IdentityIntrospection     IdentityIntrospectionRuntime
	RequireMTLS               bool
	Keyring                   *centralauthz.Keyring
}

// IdentityIntrospectionRuntime supplies the one-request, no-cache session
// check that makes logout, password reset, and account disable immediately
// visible to the canonical authorization service.
type IdentityIntrospectionRuntime struct {
	URL             string
	CertificateFile string
	KeyFile         string
	CAFile          string
	ServerName      string
	RequireMTLS     bool
}

var targetServicePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,62}$`)

const (
	identityAssertionMaximumAge = 15 * time.Minute
	identityAssertionClockSkew  = 5 * time.Second
)

// Load returns a fail-closed authorization runtime. The keyring is required in
// every environment because an allowed decision without a database capability
// would otherwise tempt downstream services to fall back to unsafe state.
func Load(environment string) (Runtime, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	runtime := Runtime{
		GRPCAddress:     value("AUTHZ_GRPC_ADDR", ":9443"),
		CertificateFile: strings.TrimSpace(value("AUTHZ_TLS_CERT_FILE", "")),
		KeyFile:         strings.TrimSpace(value("AUTHZ_TLS_KEY_FILE", "")),
		ClientCAFile:    strings.TrimSpace(value("AUTHZ_CLIENT_CA_FILE", "")),
		RequireMTLS:     environment == "production" || environment == "staging",
	}
	if !strings.Contains(runtime.GRPCAddress, ":") {
		return Runtime{}, fmt.Errorf("AUTHZ_GRPC_ADDR must include a port")
	}
	configuredFiles := 0
	for _, file := range []string{runtime.CertificateFile, runtime.KeyFile, runtime.ClientCAFile} {
		if file != "" {
			configuredFiles++
		}
	}
	if runtime.RequireMTLS && configuredFiles != 3 {
		return Runtime{}, fmt.Errorf("authorization TLS certificate, key, and client CA are required in %s", environment)
	}
	if !runtime.RequireMTLS && configuredFiles != 0 && configuredFiles != 3 {
		return Runtime{}, fmt.Errorf("authorization TLS certificate, key, and client CA must be configured together")
	}
	if configuredFiles == 3 {
		runtime.RequireMTLS = true
	}
	if runtime.RequireMTLS {
		serviceTargets, err := parseTrustedServiceTargets(value("AUTHZ_MTLS_SERVICE_TARGETS", ""))
		if err != nil {
			return Runtime{}, err
		}
		runtime.TrustedServiceTargets = serviceTargets
	}
	identityAssertionVerifier, err := parseIdentityAssertionVerifier(
		value("AUTHZ_IDENTITY_ASSERTION_ISSUER", ""),
		value("AUTHZ_IDENTITY_ASSERTION_AUDIENCE", ""),
		value("AUTHZ_IDENTITY_ASSERTION_PUBLIC_KEYS", ""),
	)
	if err != nil {
		return Runtime{}, err
	}
	runtime.IdentityAssertionVerifier = identityAssertionVerifier
	introspectionRuntime, err := loadIdentityIntrospectionRuntime(environment)
	if err != nil {
		return Runtime{}, err
	}
	runtime.IdentityIntrospection = introspectionRuntime
	keyring, err := centralauthz.ParseKeyring(value("AUTHZ_CAPABILITY_KEYS", ""))
	if err != nil {
		return Runtime{}, err
	}
	runtime.Keyring = keyring
	return runtime, nil
}

func loadIdentityIntrospectionRuntime(environment string) (IdentityIntrospectionRuntime, error) {
	runtime := IdentityIntrospectionRuntime{
		URL:             strings.TrimSpace(value("AUTHZ_IDENTITY_INTROSPECTION_URL", "http://127.0.0.1:9444")),
		CertificateFile: strings.TrimSpace(value("AUTHZ_IDENTITY_INTROSPECTION_TLS_CERT_FILE", "")),
		KeyFile:         strings.TrimSpace(value("AUTHZ_IDENTITY_INTROSPECTION_TLS_KEY_FILE", "")),
		CAFile:          strings.TrimSpace(value("AUTHZ_IDENTITY_INTROSPECTION_TLS_CA_FILE", "")),
		ServerName:      strings.TrimSpace(value("AUTHZ_IDENTITY_INTROSPECTION_TLS_SERVER_NAME", "")),
		RequireMTLS:     environment == "staging" || environment == "production",
	}
	parsed, err := url.Parse(runtime.URL)
	if err != nil || parsed.Host == "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") {
		return IdentityIntrospectionRuntime{}, fmt.Errorf("AUTHZ_IDENTITY_INTROSPECTION_URL must be an absolute HTTP(S) URL without credentials, query, or fragment")
	}
	if runtime.RequireMTLS && parsed.Scheme != "https" {
		return IdentityIntrospectionRuntime{}, fmt.Errorf("AUTHZ_IDENTITY_INTROSPECTION_URL must use https in %s", environment)
	}
	configuredFiles := 0
	for _, file := range []string{runtime.CertificateFile, runtime.KeyFile, runtime.CAFile} {
		if file != "" {
			configuredFiles++
		}
	}
	if runtime.RequireMTLS && configuredFiles != 3 {
		return IdentityIntrospectionRuntime{}, fmt.Errorf("Identity introspection client TLS certificate, key, and CA are required in %s", environment)
	}
	if !runtime.RequireMTLS && configuredFiles != 0 && configuredFiles != 3 {
		return IdentityIntrospectionRuntime{}, fmt.Errorf("Identity introspection client TLS certificate, key, and CA must be configured together")
	}
	if configuredFiles == 3 {
		if parsed.Scheme != "https" {
			return IdentityIntrospectionRuntime{}, fmt.Errorf("Identity introspection TLS credentials require an https URL")
		}
		runtime.RequireMTLS = true
	}
	return runtime, nil
}

// parseTrustedServiceTargets validates the exact SPIFFE URI SAN to target
// service mapping used by the mTLS interceptor. A caller gets capabilities
// only for its own database service; Common Names are intentionally ignored.
func parseTrustedServiceTargets(raw string) (map[string]string, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, fmt.Errorf("AUTHZ_MTLS_SERVICE_TARGETS is required when authorization mTLS is enabled")
	}

	var configured map[string]string
	if err := json.Unmarshal([]byte(raw), &configured); err != nil {
		return nil, fmt.Errorf("decode AUTHZ_MTLS_SERVICE_TARGETS: %w", err)
	}
	if len(configured) == 0 {
		return nil, fmt.Errorf("AUTHZ_MTLS_SERVICE_TARGETS cannot be empty")
	}

	trusted := make(map[string]string, len(configured))
	for rawSPIFFEID, rawTargetService := range configured {
		spiffeID, err := normalizeSPIFFEID(rawSPIFFEID)
		if err != nil {
			return nil, fmt.Errorf("invalid AUTHZ_MTLS_SERVICE_TARGETS key %q: %w", rawSPIFFEID, err)
		}
		targetService := strings.ToLower(strings.TrimSpace(rawTargetService))
		if !targetServicePattern.MatchString(targetService) {
			return nil, fmt.Errorf("invalid target service %q for SPIFFE ID %q", rawTargetService, spiffeID)
		}
		if existing, found := trusted[spiffeID]; found && existing != targetService {
			return nil, fmt.Errorf("SPIFFE ID %q maps to more than one target service", spiffeID)
		}
		trusted[spiffeID] = targetService
	}
	return trusted, nil
}

func normalizeSPIFFEID(raw string) (string, error) {
	spiffeID := strings.TrimSpace(raw)
	parsed, err := url.Parse(spiffeID)
	if err != nil || parsed.Scheme != "spiffe" || parsed.Host == "" || parsed.Opaque != "" ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path == "" || parsed.Path == "/" {
		return "", fmt.Errorf("must be an absolute SPIFFE URI SAN")
	}
	return parsed.String(), nil
}

// parseIdentityAssertionVerifier accepts only public Ed25519 verification
// keys. Private identity signing keys remain exclusively in the Identity
// service and are never configured on the authorization decision service.
func parseIdentityAssertionVerifier(issuer, audience, rawPublicKeys string) (*authn.Verifier, error) {
	issuer = strings.TrimSpace(issuer)
	audience = strings.TrimSpace(audience)
	if issuer == "" {
		return nil, fmt.Errorf("AUTHZ_IDENTITY_ASSERTION_ISSUER is required when authorization mTLS is enabled")
	}
	if audience == "" {
		return nil, fmt.Errorf("AUTHZ_IDENTITY_ASSERTION_AUDIENCE is required when authorization mTLS is enabled")
	}
	if strings.TrimSpace(rawPublicKeys) == "" {
		return nil, fmt.Errorf("AUTHZ_IDENTITY_ASSERTION_PUBLIC_KEYS is required when authorization mTLS is enabled")
	}

	var configured map[string]string
	if err := json.Unmarshal([]byte(rawPublicKeys), &configured); err != nil {
		return nil, fmt.Errorf("decode AUTHZ_IDENTITY_ASSERTION_PUBLIC_KEYS: %w", err)
	}
	if len(configured) == 0 {
		return nil, fmt.Errorf("AUTHZ_IDENTITY_ASSERTION_PUBLIC_KEYS cannot be empty")
	}
	keys := make(map[string]ed25519.PublicKey, len(configured))
	for keyID, encodedKey := range configured {
		normalizedKeyID := strings.TrimSpace(keyID)
		if _, exists := keys[normalizedKeyID]; exists {
			return nil, fmt.Errorf("identity assertion public key ID %q is duplicated", normalizedKeyID)
		}
		publicKey, err := authn.ParsePublicKey(encodedKey)
		if err != nil {
			return nil, fmt.Errorf("parse public key %q: %w", keyID, err)
		}
		keys[normalizedKeyID] = publicKey
	}
	verifier, err := authn.NewVerifier(issuer, audience, keys, identityAssertionMaximumAge, identityAssertionClockSkew)
	if err != nil {
		return nil, fmt.Errorf("configure identity assertion verifier: %w", err)
	}
	return verifier, nil
}

func value(key, fallback string) string {
	if configured, found := os.LookupEnv(key); found {
		return configured
	}
	return fallback
}
