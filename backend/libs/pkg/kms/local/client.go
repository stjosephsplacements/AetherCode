package local

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"

	"github.com/aethercode/aethercode/libs/pkg/kms"
)

// Compile-time assertion: Client must implement kms.KeyManager.
var _ kms.KeyManager = (*Client)(nil)

// Client is the local AES-256-GCM KMS adapter. A fixed 32-byte key is loaded
// once; the keyRef encodes the first 8 bytes of the key's SHA-256 digest so
// callers can detect key mismatches without storing secrets.
type Client struct {
	key    []byte
	keyRef string
}

// New constructs a local KMS client from cfg.
func New(cfg Config) *Client {
	sum := sha256.Sum256(cfg.Key)
	return &Client{
		key:    cfg.Key,
		keyRef: "local:" + base64.RawURLEncoding.EncodeToString(sum[:8]),
	}
}

// Encrypt encrypts plaintext with AES-256-GCM. The returned ciphertext
// contains the 12-byte random nonce followed by the GCM ciphertext+tag.
func (c *Client) Encrypt(_ context.Context, plaintext []byte) ([]byte, string, error) {
	block, err := aes.NewCipher(c.key)
	if err != nil {
		return nil, "", fmt.Errorf("kms local: create cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, "", fmt.Errorf("kms local: create gcm: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, "", fmt.Errorf("kms local: generate nonce: %w", err)
	}
	ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
	return ciphertext, c.keyRef, nil
}

// Decrypt decrypts ciphertext that was produced by Encrypt with the same key.
// An error is returned when keyRef does not match the client's key.
func (c *Client) Decrypt(_ context.Context, ciphertext []byte, keyRef string) ([]byte, error) {
	if keyRef != c.keyRef {
		return nil, fmt.Errorf("kms local: unknown key ref %q", keyRef)
	}
	block, err := aes.NewCipher(c.key)
	if err != nil {
		return nil, fmt.Errorf("kms local: create cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("kms local: create gcm: %w", err)
	}
	if len(ciphertext) < gcm.NonceSize() {
		return nil, fmt.Errorf("kms local: ciphertext too short")
	}
	nonce, body := ciphertext[:gcm.NonceSize()], ciphertext[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, body, nil)
	if err != nil {
		return nil, fmt.Errorf("kms local: decrypt: %w", err)
	}
	return plaintext, nil
}
