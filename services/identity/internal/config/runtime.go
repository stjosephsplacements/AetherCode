// Package config validates Identity's security-sensitive runtime settings.
package config

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/authn"
)

// Runtime contains the validated configuration needed by the Identity HTTP
// adapter. Private signing key material is loaded only here from a secret
// mount/environment and is never logged or written to the database.
type Runtime struct {
	AccessSigner                 *authn.Signer
	AccessVerifier               *authn.Verifier
	AccessTokenLifetime          time.Duration
	RefreshTokenLifetime         time.Duration
	EmailVerificationLifetime    time.Duration
	PasswordResetLifetime        time.Duration
	MFAChallengeLifetime         time.Duration
	LockoutThreshold             int
	LockoutDuration              time.Duration
	DeliveryTokenKey             []byte
	MFAMasterKeys                map[string][]byte
	MFAKeyReference              string
	ExposeDevelopmentSecrets     bool
	IntrospectionAddress         string
	IntrospectionCertificateFile string
	IntrospectionKeyFile         string
	IntrospectionClientCAFile    string
	IntrospectionTrustedSPIFFEID string
	RequireIntrospectionMTLS     bool
}

// Load rejects incomplete signing configuration in every environment. A
// process that cannot mint a valid identity assertion must not start.
func Load(environment string) (Runtime, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	privateKey, err := authn.ParsePrivateKey(value("IDENTITY_ACCESS_TOKEN_PRIVATE_KEY_BASE64", ""))
	if err != nil {
		return Runtime{}, err
	}
	signer, err := authn.NewSigner(
		value("IDENTITY_ACCESS_TOKEN_ISSUER", ""),
		value("IDENTITY_ACCESS_TOKEN_AUDIENCE", "aethercode-api"),
		value("IDENTITY_ACCESS_TOKEN_KEY_ID", ""),
		privateKey,
	)
	if err != nil {
		return Runtime{}, fmt.Errorf("configure identity access-token signer: %w", err)
	}
	accessLifetime, err := duration("IDENTITY_ACCESS_TOKEN_LIFETIME", "15m", time.Minute, 15*time.Minute)
	if err != nil {
		return Runtime{}, err
	}
	accessVerifier, err := authn.NewVerifier(
		value("IDENTITY_ACCESS_TOKEN_ISSUER", ""),
		value("IDENTITY_ACCESS_TOKEN_AUDIENCE", "aethercode-api"),
		map[string]ed25519.PublicKey{value("IDENTITY_ACCESS_TOKEN_KEY_ID", ""): signer.PublicKey()},
		accessLifetime,
		30*time.Second,
	)
	if err != nil {
		return Runtime{}, fmt.Errorf("configure identity access-token verifier: %w", err)
	}
	refreshLifetime, err := duration("IDENTITY_REFRESH_TOKEN_LIFETIME", "720h", time.Hour, 90*24*time.Hour)
	if err != nil {
		return Runtime{}, err
	}
	verificationLifetime, err := duration("IDENTITY_EMAIL_VERIFICATION_LIFETIME", "24h", time.Minute, 7*24*time.Hour)
	if err != nil {
		return Runtime{}, err
	}
	resetLifetime, err := duration("IDENTITY_PASSWORD_RESET_LIFETIME", "30m", time.Minute, 24*time.Hour)
	if err != nil {
		return Runtime{}, err
	}
	mfaChallengeLifetime, err := duration("IDENTITY_MFA_CHALLENGE_LIFETIME", "5m", time.Minute, 15*time.Minute)
	if err != nil {
		return Runtime{}, err
	}
	threshold, err := positiveInt("IDENTITY_LOCKOUT_THRESHOLD", "5", 1, 20)
	if err != nil {
		return Runtime{}, err
	}
	lockoutDuration, err := duration("IDENTITY_LOCKOUT_DURATION", "15m", time.Minute, 24*time.Hour)
	if err != nil {
		return Runtime{}, err
	}
	deliveryTokenKey, err := base64.StdEncoding.DecodeString(strings.TrimSpace(value("IDENTITY_DELIVERY_TOKEN_HMAC_KEY_BASE64", "")))
	if err != nil || len(deliveryTokenKey) < 32 {
		return Runtime{}, fmt.Errorf("IDENTITY_DELIVERY_TOKEN_HMAC_KEY_BASE64 must be standard base64 for at least 32 bytes")
	}
	mfaKeyReference := strings.TrimSpace(value("IDENTITY_MFA_KEY_REFERENCE", ""))
	if mfaKeyReference == "" || len(mfaKeyReference) > 255 {
		return Runtime{}, fmt.Errorf("IDENTITY_MFA_KEY_REFERENCE is required and must contain at most 255 characters")
	}
	mfaMasterKeys, err := parseMFAMasterKeys(value("IDENTITY_MFA_MASTER_KEYS_JSON", ""))
	if err != nil {
		return Runtime{}, err
	}
	if _, found := mfaMasterKeys[mfaKeyReference]; !found {
		return Runtime{}, fmt.Errorf("IDENTITY_MFA_KEY_REFERENCE does not identify a configured MFA master key")
	}
	introspection, err := loadIntrospectionRuntime(environment)
	if err != nil {
		return Runtime{}, err
	}
	return Runtime{
		AccessSigner:                 signer,
		AccessVerifier:               accessVerifier,
		AccessTokenLifetime:          accessLifetime,
		RefreshTokenLifetime:         refreshLifetime,
		EmailVerificationLifetime:    verificationLifetime,
		PasswordResetLifetime:        resetLifetime,
		MFAChallengeLifetime:         mfaChallengeLifetime,
		LockoutThreshold:             threshold,
		LockoutDuration:              lockoutDuration,
		DeliveryTokenKey:             append([]byte(nil), deliveryTokenKey...),
		MFAMasterKeys:                mfaMasterKeys,
		MFAKeyReference:              mfaKeyReference,
		ExposeDevelopmentSecrets:     environment == "development" || environment == "test",
		IntrospectionAddress:         introspection.address,
		IntrospectionCertificateFile: introspection.certificateFile,
		IntrospectionKeyFile:         introspection.keyFile,
		IntrospectionClientCAFile:    introspection.clientCAFile,
		IntrospectionTrustedSPIFFEID: introspection.trustedSPIFFEID,
		RequireIntrospectionMTLS:     introspection.requireMTLS,
	}, nil
}

type introspectionRuntime struct {
	address         string
	certificateFile string
	keyFile         string
	clientCAFile    string
	trustedSPIFFEID string
	requireMTLS     bool
}

func loadIntrospectionRuntime(environment string) (introspectionRuntime, error) {
	runtime := introspectionRuntime{
		address:         strings.TrimSpace(value("IDENTITY_INTROSPECTION_ADDR", "127.0.0.1:9444")),
		certificateFile: strings.TrimSpace(value("IDENTITY_INTROSPECTION_TLS_CERT_FILE", "")),
		keyFile:         strings.TrimSpace(value("IDENTITY_INTROSPECTION_TLS_KEY_FILE", "")),
		clientCAFile:    strings.TrimSpace(value("IDENTITY_INTROSPECTION_CLIENT_CA_FILE", "")),
		trustedSPIFFEID: strings.TrimSpace(value("IDENTITY_INTROSPECTION_TRUSTED_CLIENT_SPIFFE_ID", "")),
		requireMTLS:     environment == "staging" || environment == "production",
	}
	if runtime.address == "" || !strings.Contains(runtime.address, ":") {
		return introspectionRuntime{}, fmt.Errorf("IDENTITY_INTROSPECTION_ADDR must include a host and port")
	}
	configuredFiles := 0
	for _, file := range []string{runtime.certificateFile, runtime.keyFile, runtime.clientCAFile} {
		if file != "" {
			configuredFiles++
		}
	}
	if runtime.requireMTLS && configuredFiles != 3 {
		return introspectionRuntime{}, fmt.Errorf("identity introspection TLS certificate, key, and client CA are required in %s", environment)
	}
	if !runtime.requireMTLS && configuredFiles != 0 && configuredFiles != 3 {
		return introspectionRuntime{}, fmt.Errorf("identity introspection TLS certificate, key, and client CA must be configured together")
	}
	if configuredFiles == 3 {
		runtime.requireMTLS = true
	}
	if runtime.requireMTLS {
		if runtime.trustedSPIFFEID == "" {
			return introspectionRuntime{}, fmt.Errorf("IDENTITY_INTROSPECTION_TRUSTED_CLIENT_SPIFFE_ID is required when introspection mTLS is enabled")
		}
		parsed, err := url.Parse(runtime.trustedSPIFFEID)
		if err != nil || parsed.Scheme != "spiffe" || parsed.Host == "" || parsed.Path == "" || parsed.Path == "/" || parsed.RawQuery != "" || parsed.Fragment != "" {
			return introspectionRuntime{}, fmt.Errorf("IDENTITY_INTROSPECTION_TRUSTED_CLIENT_SPIFFE_ID must be an absolute SPIFFE URI")
		}
		runtime.trustedSPIFFEID = parsed.String()
	}
	return runtime, nil
}

func parseMFAMasterKeys(raw string) (map[string][]byte, error) {
	var encoded map[string]string
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &encoded); err != nil || len(encoded) == 0 {
		return nil, fmt.Errorf("IDENTITY_MFA_MASTER_KEYS_JSON must be a non-empty JSON key-reference to base64-key map")
	}
	keys := make(map[string][]byte, len(encoded))
	for reference, value := range encoded {
		reference = strings.TrimSpace(reference)
		if reference == "" || len(reference) > 255 {
			return nil, fmt.Errorf("IDENTITY_MFA_MASTER_KEYS_JSON contains an invalid key reference")
		}
		key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(value))
		if err != nil || len(key) != 32 {
			return nil, fmt.Errorf("IDENTITY_MFA_MASTER_KEYS_JSON contains a key that is not standard base64 for 32 bytes")
		}
		keys[reference] = append([]byte(nil), key...)
	}
	return keys, nil
}

func duration(key, fallback string, minimum, maximum time.Duration) (time.Duration, error) {
	parsed, err := time.ParseDuration(value(key, fallback))
	if err != nil || parsed < minimum || parsed > maximum {
		return 0, fmt.Errorf("%s must be between %s and %s", key, minimum, maximum)
	}
	return parsed, nil
}

func positiveInt(key, fallback string, minimum, maximum int) (int, error) {
	parsed, err := strconv.Atoi(value(key, fallback))
	if err != nil || parsed < minimum || parsed > maximum {
		return 0, fmt.Errorf("%s must be between %d and %d", key, minimum, maximum)
	}
	return parsed, nil
}

func value(key, fallback string) string {
	if configured, found := os.LookupEnv(key); found {
		return configured
	}
	return fallback
}
