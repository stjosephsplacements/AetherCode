// Package kms defines the key-management port. Adapters include a local
// AES-256-GCM adapter (dev/CI) and AWS KMS or Cloud KMS (production). The
// production backend is selected by changing environment variables; no code
// change is required when switching providers.
package kms

import "context"

// KeyManager is the KMS port. Implementations must be safe for concurrent use.
type KeyManager interface {
	// Encrypt encrypts plaintext and returns the ciphertext together with an
	// opaque keyRef that identifies which key was used. The keyRef must be
	// stored alongside the ciphertext; it is required to decrypt later.
	Encrypt(ctx context.Context, plaintext []byte) (ciphertext []byte, keyRef string, err error)

	// Decrypt decrypts ciphertext using the key identified by keyRef.
	Decrypt(ctx context.Context, ciphertext []byte, keyRef string) (plaintext []byte, err error)
}
