package authz

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

const (
	capabilityPrefix     = "aether-authz-context-v2"
	capabilityTTL        = 5 * time.Second
	capabilityTimeFormat = "2006-01-02T15:04:05.000000Z"
)

var (
	audiencePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,62}$`)
	uuidPattern     = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	actionPattern   = regexp.MustCompile(`^[A-Za-z0-9._:/-]{1,200}$`)
	resourcePattern = regexp.MustCompile(`^[A-Za-z0-9._:/-]{1,500}$`)
)

// Capability is a short-lived authorization decision signed by the canonical
// User service. Target databases independently validate its HMAC and their
// local authorization projection before RLS can see a tenant row.
type Capability struct {
	Audience      string
	KeyID         string
	CapabilityID  string
	ActorID       string
	TenantID      string
	AuthzRevision int64
	Decision      string
	Action        string
	Resource      string
	IssuedAt      time.Time
	ExpiresAt     time.Time
	Signature     []byte
}

// SigningKey is supplied only to the canonical authorization service through
// a secret store. Application services never receive key material.
type SigningKey struct {
	Audience string
	KeyID    string
	Secret   []byte
}

// Keyring chooses the active signing key for each database audience.
type Keyring struct {
	byAudience map[string]SigningKey
}

type signingKeyConfig struct {
	Audience     string `json:"audience"`
	KeyID        string `json:"key_id"`
	SecretBase64 string `json:"secret_base64"`
}

type encodedCapability struct {
	Audience      string `json:"audience"`
	KeyID         string `json:"key_id"`
	CapabilityID  string `json:"capability_id"`
	ActorID       string `json:"actor_id"`
	TenantID      string `json:"tenant_id"`
	AuthzRevision int64  `json:"authz_revision"`
	Decision      string `json:"decision"`
	Action        string `json:"action"`
	Resource      string `json:"resource"`
	IssuedAt      string `json:"issued_at"`
	ExpiresAt     string `json:"expires_at"`
	Signature     string `json:"signature"`
}

// ParseKeyring decodes AUTHZ_CAPABILITY_KEYS. The value is a JSON array of
// objects with audience, key_id, and secret_base64 fields. Exactly one active
// key is configured for each audience; rotation is performed by publishing a
// new key to every database before changing this configuration.
func ParseKeyring(raw string) (*Keyring, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, fmt.Errorf("authorization capability keyring is required")
	}

	var configured []signingKeyConfig
	if err := json.Unmarshal([]byte(raw), &configured); err != nil {
		return nil, fmt.Errorf("decode authorization capability keyring: %w", err)
	}
	if len(configured) == 0 {
		return nil, fmt.Errorf("authorization capability keyring cannot be empty")
	}

	keyring := &Keyring{byAudience: make(map[string]SigningKey, len(configured))}
	for _, configuredKey := range configured {
		secret, err := base64.StdEncoding.DecodeString(configuredKey.SecretBase64)
		if err != nil {
			return nil, fmt.Errorf("decode capability key for %q: %w", configuredKey.Audience, err)
		}
		key := SigningKey{
			Audience: strings.TrimSpace(configuredKey.Audience),
			KeyID:    strings.ToLower(strings.TrimSpace(configuredKey.KeyID)),
			Secret:   secret,
		}
		if err := key.Validate(); err != nil {
			return nil, err
		}
		if _, exists := keyring.byAudience[key.Audience]; exists {
			return nil, fmt.Errorf("more than one active capability key configured for audience %q", key.Audience)
		}
		keyring.byAudience[key.Audience] = key
	}
	return keyring, nil
}

// Validate verifies a signing key has the minimum characteristics required by
// the PostgreSQL authz.context_keys table and HMAC-SHA-256.
func (key SigningKey) Validate() error {
	if !audiencePattern.MatchString(key.Audience) {
		return fmt.Errorf("capability key audience %q is invalid", key.Audience)
	}
	if !uuidPattern.MatchString(strings.ToLower(key.KeyID)) {
		return fmt.Errorf("capability key ID for %q must be a UUID", key.Audience)
	}
	if len(key.Secret) < sha256.Size {
		return fmt.Errorf("capability key for %q must contain at least %d bytes", key.Audience, sha256.Size)
	}
	return nil
}

// Issue signs an allow decision for a target database. The capability is
// normalized to microseconds because PostgreSQL renders the same timestamp
// precision when rebuilding the canonical HMAC payload.
func (keyring *Keyring) Issue(
	audience, actorID, tenantID string,
	authzRevision int64,
	capabilityID string,
	action, resource string,
	now time.Time,
) (Capability, error) {
	if keyring == nil {
		return Capability{}, fmt.Errorf("authorization capability keyring is nil")
	}
	key, found := keyring.byAudience[audience]
	if !found {
		return Capability{}, fmt.Errorf("no active capability key configured for audience %q", audience)
	}
	issuedAt := normalizeCapabilityTime(now)
	capability := Capability{
		Audience:      key.Audience,
		KeyID:         key.KeyID,
		CapabilityID:  strings.ToLower(strings.TrimSpace(capabilityID)),
		ActorID:       strings.ToLower(strings.TrimSpace(actorID)),
		TenantID:      strings.ToLower(strings.TrimSpace(tenantID)),
		AuthzRevision: authzRevision,
		Decision:      "allow",
		Action:        strings.TrimSpace(action),
		Resource:      strings.TrimSpace(resource),
		IssuedAt:      issuedAt,
		ExpiresAt:     issuedAt.Add(capabilityTTL),
	}
	mac := hmac.New(sha256.New, key.Secret)
	_, _ = mac.Write([]byte(capability.CanonicalPayload()))
	capability.Signature = mac.Sum(nil)
	if err := capability.ValidateAt(issuedAt); err != nil {
		return Capability{}, err
	}
	return capability, nil
}

// Encode returns the opaque base64url envelope carried in AuthorizeResponse.
func (capability Capability) Encode() (string, error) {
	if err := capability.ValidateAt(capability.IssuedAt); err != nil {
		return "", err
	}
	payload, err := json.Marshal(encodedCapability{
		Audience:      capability.Audience,
		KeyID:         capability.KeyID,
		CapabilityID:  capability.CapabilityID,
		ActorID:       capability.ActorID,
		TenantID:      capability.TenantID,
		AuthzRevision: capability.AuthzRevision,
		Decision:      capability.Decision,
		Action:        capability.Action,
		Resource:      capability.Resource,
		IssuedAt:      capabilityTimestamp(capability.IssuedAt),
		ExpiresAt:     capabilityTimestamp(capability.ExpiresAt),
		Signature:     base64.RawURLEncoding.EncodeToString(capability.Signature),
	})
	if err != nil {
		return "", fmt.Errorf("encode authorization capability: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

// DecodeCapability parses an authorization envelope without possessing the
// signing key. The target PostgreSQL database performs the authoritative HMAC
// validation in authz.set_context.
func DecodeCapability(encoded string, now time.Time) (Capability, error) {
	payload, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return Capability{}, fmt.Errorf("decode authorization capability envelope: %w", err)
	}
	var raw encodedCapability
	if err := json.Unmarshal(payload, &raw); err != nil {
		return Capability{}, fmt.Errorf("decode authorization capability JSON: %w", err)
	}
	issuedAt, err := time.Parse(capabilityTimeFormat, raw.IssuedAt)
	if err != nil {
		return Capability{}, fmt.Errorf("parse authorization capability issued_at: %w", err)
	}
	expiresAt, err := time.Parse(capabilityTimeFormat, raw.ExpiresAt)
	if err != nil {
		return Capability{}, fmt.Errorf("parse authorization capability expires_at: %w", err)
	}
	signature, err := base64.RawURLEncoding.DecodeString(raw.Signature)
	if err != nil {
		return Capability{}, fmt.Errorf("decode authorization capability signature: %w", err)
	}
	capability := Capability{
		Audience:      raw.Audience,
		KeyID:         strings.ToLower(raw.KeyID),
		CapabilityID:  strings.ToLower(raw.CapabilityID),
		ActorID:       strings.ToLower(raw.ActorID),
		TenantID:      strings.ToLower(raw.TenantID),
		AuthzRevision: raw.AuthzRevision,
		Decision:      raw.Decision,
		Action:        raw.Action,
		Resource:      raw.Resource,
		IssuedAt:      issuedAt,
		ExpiresAt:     expiresAt,
		Signature:     signature,
	}
	if err := capability.ValidateAt(now); err != nil {
		return Capability{}, err
	}
	return capability, nil
}

// CanonicalPayload exactly matches authz.context_signature_payload in every
// service database migration. Keep both forms synchronized by its tests.
func (capability Capability) CanonicalPayload() string {
	return strings.Join([]string{
		capabilityPrefix,
		capability.Audience,
		strings.ToLower(capability.KeyID),
		strings.ToLower(capability.CapabilityID),
		strings.ToLower(capability.ActorID),
		strings.ToLower(capability.TenantID),
		fmt.Sprintf("%d", capability.AuthzRevision),
		capability.Decision,
		capability.Action,
		capability.Resource,
		capabilityTimestamp(capability.IssuedAt),
		capabilityTimestamp(capability.ExpiresAt),
	}, "|")
}

// ValidateAt rejects malformed, stale, overlong, or non-allow decisions
// before they reach a target database. Database validation remains required.
func (capability Capability) ValidateAt(now time.Time) error {
	if !audiencePattern.MatchString(capability.Audience) {
		return fmt.Errorf("authorization capability audience is invalid")
	}
	if !uuidPattern.MatchString(strings.ToLower(capability.KeyID)) {
		return fmt.Errorf("authorization capability key ID must be a UUID")
	}
	if !uuidPattern.MatchString(strings.ToLower(capability.CapabilityID)) {
		return fmt.Errorf("authorization capability ID must be a UUID")
	}
	if !uuidPattern.MatchString(strings.ToLower(capability.ActorID)) {
		return fmt.Errorf("authorization capability actor ID must be a UUID")
	}
	if capability.TenantID != "" && !uuidPattern.MatchString(strings.ToLower(capability.TenantID)) {
		return fmt.Errorf("authorization capability tenant ID must be a UUID")
	}
	if capability.AuthzRevision <= 0 {
		return fmt.Errorf("authorization capability revision must be positive")
	}
	if capability.Decision != "allow" {
		return fmt.Errorf("authorization capability decision must be allow")
	}
	if !actionPattern.MatchString(capability.Action) || !resourcePattern.MatchString(capability.Resource) {
		return fmt.Errorf("authorization capability action or resource is invalid")
	}
	if len(capability.Signature) != sha256.Size {
		return fmt.Errorf("authorization capability signature must be %d bytes", sha256.Size)
	}
	issuedAt := normalizeCapabilityTime(capability.IssuedAt)
	expiresAt := normalizeCapabilityTime(capability.ExpiresAt)
	if !issuedAt.Equal(capability.IssuedAt.UTC()) || !expiresAt.Equal(capability.ExpiresAt.UTC()) {
		return fmt.Errorf("authorization capability timestamps must have microsecond UTC precision")
	}
	if !expiresAt.After(issuedAt) || expiresAt.Sub(issuedAt) > capabilityTTL {
		return fmt.Errorf("authorization capability lifetime must be between zero and five seconds")
	}
	if !expiresAt.After(now.UTC()) {
		return fmt.Errorf("authorization capability has expired")
	}
	if issuedAt.After(now.UTC().Add(time.Second)) {
		return fmt.Errorf("authorization capability issued_at is too far in the future")
	}
	return nil
}

func normalizeCapabilityTime(value time.Time) time.Time {
	return value.UTC().Truncate(time.Microsecond)
}

func capabilityTimestamp(value time.Time) string {
	return normalizeCapabilityTime(value).Format(capabilityTimeFormat)
}
