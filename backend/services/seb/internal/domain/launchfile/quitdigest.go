package launchfile

import (
	"crypto/sha256"
	"encoding/hex"
)

// quitPasswordHex returns the SHA-256 hex SEB expects in the quitPassword
// plist field. The input is a 24-byte random launch secret (SEB_LAUNCH_PASSWORD),
// not a human password; this file is listed under CodeQL paths-ignore for that reason.
func quitPasswordHex(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}
