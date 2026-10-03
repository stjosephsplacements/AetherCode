package authn

import (
	"encoding/json"
	"fmt"
	"strings"
)

// UnverifiedSubject extracts a syntactically valid UUID subject from a compact
// JWS without trusting its signature. It exists only so a downstream service
// can populate the principal_id field of the central Authorize request; the
// canonical User service verifies the signature and rejects any mismatch.
// Callers must never treat this result as authenticated on its own.
func UnverifiedSubject(token string) (string, error) {
	if len(token) == 0 || len(token) > maximumAssertionBytes {
		return "", fmt.Errorf("identity assertion length is invalid")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[1] == "" {
		return "", fmt.Errorf("identity assertion must be compact JWS")
	}
	rawClaims, err := decodeCanonicalBase64URL(parts[1])
	if err != nil {
		return "", fmt.Errorf("decode identity assertion claims: %w", err)
	}
	var claims struct {
		Subject string `json:"sub"`
	}
	if err := json.Unmarshal(rawClaims, &claims); err != nil {
		return "", fmt.Errorf("decode identity assertion claims JSON: %w", err)
	}
	claims.Subject = strings.ToLower(strings.TrimSpace(claims.Subject))
	if !uuidPattern.MatchString(claims.Subject) {
		return "", fmt.Errorf("identity assertion subject is invalid")
	}
	return claims.Subject, nil
}
