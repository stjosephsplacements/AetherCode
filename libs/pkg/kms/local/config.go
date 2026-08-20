// Package local implements the kms.KeyManager port using a single AES-256-GCM
// key sourced from an environment variable. This adapter is intended for local
// development and CI only; production must use a managed KMS provider.
package local

import (
	"encoding/base64"
	"fmt"
	"os"
)

// Config holds the symmetric key for the local AES-256-GCM adapter.
type Config struct {
	Key []byte // exactly 32 bytes (AES-256)
}

// LoadConfig reads the KMS key from the environment variable
// {prefix}_KMS_LOCAL_KEY, which must be a base64-standard-encoded 32-byte
// value. For example, LoadConfig("QBANK") reads QBANK_KMS_LOCAL_KEY.
func LoadConfig(prefix string) (Config, error) {
	raw := os.Getenv(prefix + "_KMS_LOCAL_KEY")
	if raw == "" {
		return Config{}, fmt.Errorf("kms: %s_KMS_LOCAL_KEY is required", prefix)
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return Config{}, fmt.Errorf("kms: decode %s_KMS_LOCAL_KEY: %w", prefix, err)
	}
	if len(key) != 32 {
		return Config{}, fmt.Errorf("kms: %s_KMS_LOCAL_KEY must decode to exactly 32 bytes, got %d", prefix, len(key))
	}
	return Config{Key: key}, nil
}
