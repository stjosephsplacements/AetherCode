package domain

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" // RFC 6238 default algorithm; SHA-1 is only used inside HMAC.
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const (
	mfaDataKeyBytes   = 32
	mfaSecretBytes    = 20
	totpStep          = 30 * time.Second
	totpDigits        = 6
	maximumClockDrift = 1
)

// ProtectedSecret is an envelope-encrypted value. Both byte slices include
// their AES-GCM nonces and can safely be persisted alongside a KMS key
// reference; neither contains the plaintext TOTP secret.
type ProtectedSecret struct {
	Ciphertext       []byte
	EncryptedDataKey []byte
}

// NewTOTPSecret creates a standard unpadded Base32 TOTP seed for display in a
// QR URI. It is intentionally returned only from the enrollment initiation
// flow and is never stored in plaintext.
func NewTOTPSecret() (string, error) {
	secret := make([]byte, mfaSecretBytes)
	if _, err := rand.Read(secret); err != nil {
		return "", fmt.Errorf("read TOTP secret randomness: %w", err)
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(secret), nil
}

// ProtectMFASecret encrypts a TOTP seed with a fresh data-encryption key and
// encrypts that DEK under the configured KMS-unwrapped master key.
func ProtectMFASecret(masterKey []byte, secret string) (ProtectedSecret, error) {
	if len(masterKey) != mfaDataKeyBytes {
		return ProtectedSecret{}, fmt.Errorf("MFA master key must contain %d bytes", mfaDataKeyBytes)
	}
	if _, err := decodeTOTPSecret(secret); err != nil {
		return ProtectedSecret{}, err
	}
	dataKey := make([]byte, mfaDataKeyBytes)
	if _, err := rand.Read(dataKey); err != nil {
		return ProtectedSecret{}, fmt.Errorf("read MFA data-key randomness: %w", err)
	}
	ciphertext, err := seal(dataKey, []byte(secret))
	if err != nil {
		return ProtectedSecret{}, fmt.Errorf("encrypt MFA secret: %w", err)
	}
	encryptedDataKey, err := seal(masterKey, dataKey)
	if err != nil {
		return ProtectedSecret{}, fmt.Errorf("encrypt MFA data key: %w", err)
	}
	return ProtectedSecret{Ciphertext: ciphertext, EncryptedDataKey: encryptedDataKey}, nil
}

// UnprotectMFASecret decrypts an envelope payload only in the trusted Identity
// process immediately before TOTP verification.
func UnprotectMFASecret(masterKey []byte, protected ProtectedSecret) (string, error) {
	if len(masterKey) != mfaDataKeyBytes {
		return "", fmt.Errorf("MFA master key must contain %d bytes", mfaDataKeyBytes)
	}
	dataKey, err := open(masterKey, protected.EncryptedDataKey)
	if err != nil || len(dataKey) != mfaDataKeyBytes {
		return "", fmt.Errorf("decrypt MFA data key")
	}
	secret, err := open(dataKey, protected.Ciphertext)
	if err != nil {
		return "", fmt.Errorf("decrypt MFA secret")
	}
	decoded := string(secret)
	if _, err := decodeTOTPSecret(decoded); err != nil {
		return "", fmt.Errorf("decrypted MFA secret is invalid")
	}
	return decoded, nil
}

// ValidateTOTP accepts the current 30-second time slice plus one bounded slice
// on either side, preventing a client clock skew from weakening replay bounds.
func ValidateTOTP(secret, code string, now time.Time) bool {
	code = strings.TrimSpace(code)
	if len(code) != totpDigits {
		return false
	}
	if _, err := strconv.Atoi(code); err != nil {
		return false
	}
	decodedSecret, err := decodeTOTPSecret(secret)
	if err != nil {
		return false
	}
	counter := now.UTC().Unix() / int64(totpStep/time.Second)
	matched := 0
	for offset := -maximumClockDrift; offset <= maximumClockDrift; offset++ {
		candidate := totpCode(decodedSecret, uint64(counter+int64(offset)))
		matched |= subtle.ConstantTimeCompare([]byte(candidate), []byte(code))
	}
	return matched == 1
}

// NewRecoveryCode produces a human-readable high-entropy recovery credential.
// Only HashRecoveryCode is persisted.
func NewRecoveryCode() (string, error) {
	value := make([]byte, 10)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("read recovery-code randomness: %w", err)
	}
	encoded := strings.ToUpper(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(value))
	return encoded[:8] + "-" + encoded[8:], nil
}

// HashRecoveryCode normalizes hyphenated recovery input before hashing it.
func HashRecoveryCode(code string) [sha256.Size]byte {
	normalized := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(code), "-", ""))
	return sha256.Sum256([]byte(normalized))
}

func decodeTOTPSecret(secret string) ([]byte, error) {
	secret = strings.ToUpper(strings.TrimSpace(secret))
	if secret == "" {
		return nil, fmt.Errorf("TOTP secret is required")
	}
	decoded, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	if err != nil || len(decoded) < 16 || len(decoded) > 64 {
		return nil, fmt.Errorf("TOTP secret is invalid")
	}
	return decoded, nil
}

func totpCode(secret []byte, counter uint64) string {
	var counterBytes [8]byte
	binary.BigEndian.PutUint64(counterBytes[:], counter)
	mac := hmac.New(sha1.New, secret)
	_, _ = mac.Write(counterBytes[:])
	digest := mac.Sum(nil)
	offset := digest[len(digest)-1] & 0x0f
	value := binary.BigEndian.Uint32(digest[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", value%1_000_000)
}

func seal(key, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

func open(key, encoded []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(encoded) < gcm.NonceSize()+gcm.Overhead() {
		return nil, fmt.Errorf("encrypted value is too short")
	}
	nonce := encoded[:gcm.NonceSize()]
	return gcm.Open(nil, nonce, encoded[gcm.NonceSize():], nil)
}
