package domain

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"regexp"
	"strings"
)

var deliveryTokenIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// NewOpaqueToken creates a high-entropy bearer secret suitable for a refresh,
// email-verification, or reset channel. Callers persist only HashToken(token).
func NewOpaqueToken() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("read opaque token randomness: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

// HashToken returns the fixed-length database representation of an opaque
// bearer token; token plaintext is never persisted.
func HashToken(token string) [sha256.Size]byte {
	return sha256.Sum256([]byte(token))
}

// DeriveDeliveryToken deterministically creates a one-time email delivery
// bearer from a KMS-provisioned HMAC key and a persisted token ID. The token
// ID is public routing data; its MAC is the secret. A delivery worker can
// therefore recover a link after a crash without storing a plaintext bearer
// in PostgreSQL or an outbox payload.
func DeriveDeliveryToken(key []byte, purpose, tokenID string) (string, error) {
	if len(key) < 32 {
		return "", fmt.Errorf("delivery token HMAC key must contain at least 32 bytes")
	}
	purpose = strings.TrimSpace(purpose)
	tokenID = strings.ToLower(strings.TrimSpace(tokenID))
	if purpose != "email-verification" && purpose != "password-reset" {
		return "", fmt.Errorf("delivery token purpose is invalid")
	}
	if !deliveryTokenIDPattern.MatchString(tokenID) {
		return "", fmt.Errorf("delivery token ID must be a UUID")
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte("aethercode-delivery-token-v1|" + purpose + "|" + tokenID))
	return "adt1." + purpose + "." + tokenID + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}
