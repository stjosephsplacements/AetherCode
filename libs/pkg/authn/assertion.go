// Package authn issues and verifies the short-lived Ed25519 identity
// assertions carried from an authenticated API request to the authorization
// decision service. It intentionally implements only the tightly constrained
// JWS profile used by AetherCode rather than a permissive general JWT parser.
package authn

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

const (
	algorithm             = "EdDSA"
	tokenType             = "JWT"
	maximumAssertionBytes = 8192
)

var (
	identifierPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)
	uuidPattern       = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
)

// Claims are the identity facts authorized by the Identity service. Times use
// Unix seconds because that is the interoperable JWT representation.
type Claims struct {
	Issuer    string   `json:"iss"`
	Audience  []string `json:"aud"`
	Subject   string   `json:"sub"`
	TokenID   string   `json:"jti"`
	IssuedAt  int64    `json:"iat"`
	NotBefore int64    `json:"nbf"`
	ExpiresAt int64    `json:"exp"`
}

type header struct {
	Algorithm string `json:"alg"`
	Type      string `json:"typ"`
	KeyID     string `json:"kid"`
}

// Signer signs assertions with one current Ed25519 private key.
type Signer struct {
	issuer   string
	audience string
	keyID    string
	key      ed25519.PrivateKey
}

// NewSigner validates the immutable identity-assertion issuer configuration.
func NewSigner(issuer, audience, keyID string, key ed25519.PrivateKey) (*Signer, error) {
	issuer = strings.TrimSpace(issuer)
	audience = strings.TrimSpace(audience)
	keyID = strings.TrimSpace(keyID)
	if issuer == "" || audience == "" {
		return nil, fmt.Errorf("identity assertion issuer and audience are required")
	}
	if !identifierPattern.MatchString(keyID) {
		return nil, fmt.Errorf("identity assertion key ID is invalid")
	}
	if len(key) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("identity assertion private key must be %d bytes", ed25519.PrivateKeySize)
	}
	return &Signer{issuer: issuer, audience: audience, keyID: keyID, key: append(ed25519.PrivateKey(nil), key...)}, nil
}

// PublicKey returns a copy of the signing key's public half so the Identity
// service can authenticate its own bearer endpoints without exposing private
// key material outside the signer.
func (signer *Signer) PublicKey() ed25519.PublicKey {
	if signer == nil || len(signer.key) != ed25519.PrivateKeySize {
		return nil
	}
	publicKey := signer.key.Public().(ed25519.PublicKey)
	return append(ed25519.PublicKey(nil), publicKey...)
}

// ParsePrivateKey decodes a standard-base64 32-byte Ed25519 seed or 64-byte
// private key from a secret mount value.
func ParsePrivateKey(encoded string) (ed25519.PrivateKey, error) {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return nil, fmt.Errorf("decode identity assertion private key: %w", err)
	}
	switch len(raw) {
	case ed25519.SeedSize:
		return ed25519.NewKeyFromSeed(raw), nil
	case ed25519.PrivateKeySize:
		return ed25519.PrivateKey(raw), nil
	default:
		return nil, fmt.Errorf("identity assertion private key must decode to %d-byte seed or %d-byte private key", ed25519.SeedSize, ed25519.PrivateKeySize)
	}
}

// Issue produces a compact JWS assertion with a bounded lifetime.
func (signer *Signer) Issue(subject, tokenID string, issuedAt time.Time, lifetime time.Duration) (string, Claims, error) {
	if signer == nil {
		return "", Claims{}, fmt.Errorf("identity assertion signer is nil")
	}
	subject = strings.ToLower(strings.TrimSpace(subject))
	tokenID = strings.ToLower(strings.TrimSpace(tokenID))
	if !uuidPattern.MatchString(subject) || !uuidPattern.MatchString(tokenID) {
		return "", Claims{}, fmt.Errorf("identity assertion subject and token ID must be UUIDs")
	}
	if lifetime <= 0 || lifetime > 15*time.Minute {
		return "", Claims{}, fmt.Errorf("identity assertion lifetime must be between zero and fifteen minutes")
	}
	issuedAt = issuedAt.UTC().Truncate(time.Second)
	claims := Claims{
		Issuer: signer.issuer, Audience: []string{signer.audience}, Subject: subject, TokenID: tokenID,
		IssuedAt: issuedAt.Unix(), NotBefore: issuedAt.Unix(), ExpiresAt: issuedAt.Add(lifetime).Unix(),
	}
	encodedHeader, err := encodeJSON(header{Algorithm: algorithm, Type: tokenType, KeyID: signer.keyID})
	if err != nil {
		return "", Claims{}, err
	}
	encodedClaims, err := encodeJSON(claims)
	if err != nil {
		return "", Claims{}, err
	}
	signingInput := encodedHeader + "." + encodedClaims
	signature := ed25519.Sign(signer.key, []byte(signingInput))
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(signature), claims, nil
}

func encodeJSON(value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("encode identity assertion: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// Verifier accepts only configured public keys and one exact issuer/audience.
// Key rotation is represented by retaining the prior key until every issued
// assertion could have expired.
type Verifier struct {
	issuer     string
	audience   string
	keys       map[string]ed25519.PublicKey
	maximumAge time.Duration
	clockSkew  time.Duration
}

// NewVerifier constructs a strict verifier. maximumAge must match the maximum
// assertion lifetime issued by Identity; clockSkew is intentionally small.
func NewVerifier(issuer, audience string, keys map[string]ed25519.PublicKey, maximumAge, clockSkew time.Duration) (*Verifier, error) {
	issuer = strings.TrimSpace(issuer)
	audience = strings.TrimSpace(audience)
	if issuer == "" || audience == "" {
		return nil, fmt.Errorf("identity assertion issuer and audience are required")
	}
	if maximumAge <= 0 || maximumAge > 15*time.Minute {
		return nil, fmt.Errorf("identity assertion maximum age must be between zero and fifteen minutes")
	}
	if clockSkew < 0 || clockSkew > time.Minute {
		return nil, fmt.Errorf("identity assertion clock skew must be between zero and one minute")
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("at least one identity assertion public key is required")
	}
	verifiedKeys := make(map[string]ed25519.PublicKey, len(keys))
	for keyID, key := range keys {
		keyID = strings.TrimSpace(keyID)
		if !identifierPattern.MatchString(keyID) {
			return nil, fmt.Errorf("identity assertion key ID is invalid")
		}
		if len(key) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("identity assertion public key %q must be %d bytes", keyID, ed25519.PublicKeySize)
		}
		verifiedKeys[keyID] = append(ed25519.PublicKey(nil), key...)
	}
	return &Verifier{issuer: issuer, audience: audience, keys: verifiedKeys, maximumAge: maximumAge, clockSkew: clockSkew}, nil
}

// ParsePublicKey decodes one standard-base64 Ed25519 public key.
func ParsePublicKey(encoded string) (ed25519.PublicKey, error) {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return nil, fmt.Errorf("decode identity assertion public key: %w", err)
	}
	if len(raw) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("identity assertion public key must decode to %d bytes", ed25519.PublicKeySize)
	}
	return ed25519.PublicKey(raw), nil
}

// Verify checks JWS structure, Ed25519 signature, issuer, audience, identity
// identifiers, and all bounded time claims before returning trusted claims.
func (verifier *Verifier) Verify(token string, now time.Time) (Claims, error) {
	if verifier == nil {
		return Claims{}, fmt.Errorf("identity assertion verifier is nil")
	}
	if len(token) == 0 || len(token) > maximumAssertionBytes {
		return Claims{}, fmt.Errorf("identity assertion length is invalid")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return Claims{}, fmt.Errorf("identity assertion must be compact JWS")
	}
	rawHeader, err := decodeCanonicalBase64URL(parts[0])
	if err != nil {
		return Claims{}, fmt.Errorf("decode identity assertion header: %w", err)
	}
	var parsedHeader header
	if err := json.Unmarshal(rawHeader, &parsedHeader); err != nil {
		return Claims{}, fmt.Errorf("decode identity assertion header JSON: %w", err)
	}
	if parsedHeader.Algorithm != algorithm || parsedHeader.Type != tokenType || !identifierPattern.MatchString(parsedHeader.KeyID) {
		return Claims{}, fmt.Errorf("identity assertion header is invalid")
	}
	publicKey, found := verifier.keys[parsedHeader.KeyID]
	if !found {
		return Claims{}, fmt.Errorf("identity assertion key is not trusted")
	}
	signature, err := decodeCanonicalBase64URL(parts[2])
	if err != nil || len(signature) != ed25519.SignatureSize {
		return Claims{}, fmt.Errorf("identity assertion signature is invalid")
	}
	if !ed25519.Verify(publicKey, []byte(parts[0]+"."+parts[1]), signature) {
		return Claims{}, fmt.Errorf("identity assertion signature is invalid")
	}
	rawClaims, err := decodeCanonicalBase64URL(parts[1])
	if err != nil {
		return Claims{}, fmt.Errorf("decode identity assertion claims: %w", err)
	}
	var claims Claims
	if err := json.Unmarshal(rawClaims, &claims); err != nil {
		return Claims{}, fmt.Errorf("decode identity assertion claims JSON: %w", err)
	}
	if claims.Issuer != verifier.issuer || !containsAudience(claims.Audience, verifier.audience) {
		return Claims{}, fmt.Errorf("identity assertion issuer or audience is invalid")
	}
	claims.Subject = strings.ToLower(strings.TrimSpace(claims.Subject))
	claims.TokenID = strings.ToLower(strings.TrimSpace(claims.TokenID))
	if !uuidPattern.MatchString(claims.Subject) || !uuidPattern.MatchString(claims.TokenID) {
		return Claims{}, fmt.Errorf("identity assertion subject or token ID is invalid")
	}
	nowUnix := now.UTC().Unix()
	if claims.IssuedAt <= 0 || claims.NotBefore <= 0 || claims.ExpiresAt <= claims.IssuedAt || claims.NotBefore < claims.IssuedAt {
		return Claims{}, fmt.Errorf("identity assertion time claims are invalid")
	}
	if time.Duration(claims.ExpiresAt-claims.IssuedAt)*time.Second > verifier.maximumAge {
		return Claims{}, fmt.Errorf("identity assertion lifetime is too long")
	}
	skew := int64(verifier.clockSkew / time.Second)
	if claims.IssuedAt > nowUnix+skew || claims.NotBefore > nowUnix+skew || claims.ExpiresAt <= nowUnix-skew {
		return Claims{}, fmt.Errorf("identity assertion is not currently valid")
	}
	return claims, nil
}

func containsAudience(audiences []string, expected string) bool {
	for _, audience := range audiences {
		if audience == expected {
			return true
		}
	}
	return false
}

// decodeCanonicalBase64URL rejects alternate encodings of the same bytes. In
// particular, the unused low bits of a final raw-base64url character must be
// zero; otherwise a tampered JWS signature can decode to its original bytes.
func decodeCanonicalBase64URL(encoded string) ([]byte, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return nil, err
	}
	if base64.RawURLEncoding.EncodeToString(decoded) != encoded {
		return nil, fmt.Errorf("base64url value is not canonical")
	}
	return decoded, nil
}
