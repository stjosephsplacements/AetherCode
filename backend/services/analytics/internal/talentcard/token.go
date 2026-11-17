// Package talentcard signs and verifies talent card tokens (ADR-0081). A token is
// "v1.<base64url claims>.<base64url Ed25519 signature>", signed with a key that is
// separate from the identity keyring, so session revocation and key rotation of
// one never touch the other.
package talentcard

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const tokenPrefix = "v1"

// ErrInvalidToken is returned for any token that is malformed or not signed by this key.
var ErrInvalidToken = errors.New("talent card token is invalid")

// Claims is what a card attests. Optional fields are omitted when the student's
// consent or the drive's blind-evaluation setting hides them.
type Claims struct {
	KeyID       string   `json:"kid"`
	CardID      string   `json:"card_id"`
	IssuedAt    int64    `json:"iat"`
	ExpiresAt   int64    `json:"exp"`
	Name        string   `json:"name,omitempty"`
	College     string   `json:"college,omitempty"`
	Department  string   `json:"department,omitempty"`
	RollNumber  string   `json:"roll_number,omitempty"`
	Email       string   `json:"email,omitempty"`
	Phone       string   `json:"phone,omitempty"`
	ExamCount   int      `json:"exam_count"`
	TopPercent  *int     `json:"top_percent,omitempty"`
	Accuracy    *float64 `json:"accuracy,omitempty"`
	Evaluations int      `json:"evaluations"`
	SpeedIndex  *int     `json:"speed_index,omitempty"`
}

// Signer signs and verifies with one Ed25519 key.
type Signer struct {
	private ed25519.PrivateKey
	public  ed25519.PublicKey
	keyID   string
}

// NewSigner builds a signer from a base64 32-byte Ed25519 seed (TALENT_CARD_SIGNING_KEY).
func NewSigner(seedBase64 string) (*Signer, error) {
	seed, err := base64.StdEncoding.DecodeString(strings.TrimSpace(seedBase64))
	if err != nil || len(seed) != ed25519.SeedSize {
		return nil, fmt.Errorf("talent card signing key must be a base64 encoded %d-byte Ed25519 seed", ed25519.SeedSize)
	}
	private := ed25519.NewKeyFromSeed(seed)
	public := private.Public().(ed25519.PublicKey)
	digest := sha256.Sum256(public)
	return &Signer{private: private, public: public, keyID: hex.EncodeToString(digest[:4])}, nil
}

// KeyID names the signing key in every card, so a rotation is visible.
func (signer *Signer) KeyID() string { return signer.keyID }

// Sign stamps the claims with this key's id and returns the token.
func (signer *Signer) Sign(claims Claims) (string, error) {
	claims.KeyID = signer.keyID
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", fmt.Errorf("encode talent card claims: %w", err)
	}
	body := tokenPrefix + "." + base64.RawURLEncoding.EncodeToString(payload)
	signature := ed25519.Sign(signer.private, []byte(body))
	return body + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

// Verify checks the signature and key id and returns the claims. Expiry and
// revocation are the caller's to check.
func (signer *Signer) Verify(token string) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != tokenPrefix {
		return Claims{}, ErrInvalidToken
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(signature) != ed25519.SignatureSize {
		return Claims{}, ErrInvalidToken
	}
	if !ed25519.Verify(signer.public, []byte(parts[0]+"."+parts[1]), signature) {
		return Claims{}, ErrInvalidToken
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Claims{}, ErrInvalidToken
	}
	var claims Claims
	if err := json.Unmarshal(payload, &claims); err != nil || claims.KeyID != signer.keyID || claims.CardID == "" {
		return Claims{}, ErrInvalidToken
	}
	return claims, nil
}
