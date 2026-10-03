// Package domain contains identity business rules with no transport or
// database-framework dependencies.
package domain

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

const (
	argonMemory      = 64 * 1024
	argonIterations  = 3
	argonParallelism = 4
	argonSaltLength  = 16
	argonKeyLength   = 32
)

// ValidatePassword enforces the v1 password policy before Argon2id work is
// spent. It intentionally permits symbols without forcing any particular one.
func ValidatePassword(password string) error {
	length := utf8.RuneCountInString(password)
	if length < 12 || length > 256 {
		return fmt.Errorf("password must contain between 12 and 256 characters")
	}
	var hasLetter, hasNumber bool
	for _, character := range password {
		hasLetter = hasLetter || unicode.IsLetter(character)
		hasNumber = hasNumber || unicode.IsNumber(character)
	}
	if !hasLetter || !hasNumber {
		return fmt.Errorf("password must contain at least one letter and one number")
	}
	return nil
}

// HashPassword returns a self-describing Argon2id PHC string.
func HashPassword(password string) (string, error) {
	if err := ValidatePassword(password); err != nil {
		return "", err
	}
	salt := make([]byte, argonSaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("read password salt: %w", err)
	}
	hash := argon2.IDKey([]byte(password), salt, argonIterations, argonMemory, argonParallelism, argonKeyLength)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonIterations, argonParallelism,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(hash)), nil
}

// VerifyPassword checks a PHC Argon2id hash in constant time. It returns false
// for malformed or unsupported hashes without leaking parsing detail.
func VerifyPassword(encodedHash, password string) bool {
	parts := strings.Split(encodedHash, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" {
		return false
	}
	version, err := parsePHCValue(parts[2], "v")
	if err != nil || version != argon2.Version {
		return false
	}
	parameters := strings.Split(parts[3], ",")
	if len(parameters) != 3 {
		return false
	}
	memory, err := parsePHCValue(parameters[0], "m")
	if err != nil || memory < 8*1024 || memory > 1024*1024 {
		return false
	}
	iterations, err := parsePHCValue(parameters[1], "t")
	if err != nil || iterations < 1 || iterations > 10 {
		return false
	}
	parallelism, err := parsePHCValue(parameters[2], "p")
	if err != nil || parallelism < 1 || parallelism > 16 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) < 16 || len(salt) > 64 {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(expected) != argonKeyLength {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, uint32(iterations), uint32(memory), uint8(parallelism), uint32(len(expected)))
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

func parsePHCValue(raw, prefix string) (int, error) {
	value, found := strings.CutPrefix(raw, prefix+"=")
	if !found || value == "" {
		return 0, fmt.Errorf("PHC %s value is invalid", prefix)
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("PHC %s value is invalid", prefix)
	}
	return parsed, nil
}
