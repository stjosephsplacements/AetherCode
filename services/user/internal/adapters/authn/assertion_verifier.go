// Package authn adapts the shared strict identity assertion verifier to the
// User authorization use case.
package authn

import (
	"context"
	"fmt"
	"time"

	sharedauthn "github.com/aethercode/aethercode/libs/pkg/authn"
	"github.com/aethercode/aethercode/services/user/internal/app"
)

// AssertionVerifier verifies an Ed25519 identity assertion before User Authz
// evaluates policy. It exposes only the principal needed by the use case,
// keeping JWS parsing at the infrastructure boundary.
type AssertionVerifier struct {
	verifier         *sharedauthn.Verifier
	sessionValidator TokenSessionValidator
	now              func() time.Time
}

// TokenSessionValidator is Identity's live, fail-closed session check.
type TokenSessionValidator interface {
	Validate(context.Context, string) error
}

// NewAssertionVerifier wraps the shared strict assertion verifier. A nil
// verifier is rejected so production composition cannot accidentally accept
// unsigned identity input.
func NewAssertionVerifier(verifier *sharedauthn.Verifier, sessionValidator TokenSessionValidator) (*AssertionVerifier, error) {
	if verifier == nil {
		return nil, fmt.Errorf("shared identity assertion verifier is required")
	}
	if sessionValidator == nil {
		return nil, fmt.Errorf("Identity session validator is required")
	}
	return &AssertionVerifier{verifier: verifier, sessionValidator: sessionValidator, now: time.Now}, nil
}

// Verify satisfies app.IdentityAssertionVerifier.
func (verifier *AssertionVerifier) Verify(contextValue context.Context, assertion string) (app.VerifiedIdentity, error) {
	if err := contextValue.Err(); err != nil {
		return app.VerifiedIdentity{}, err
	}
	if verifier == nil || verifier.verifier == nil {
		return app.VerifiedIdentity{}, fmt.Errorf("shared identity assertion verifier is not initialized")
	}
	claims, err := verifier.verifier.Verify(assertion, verifier.now())
	if err != nil {
		return app.VerifiedIdentity{}, fmt.Errorf("verify identity assertion: %w", err)
	}
	if err := verifier.sessionValidator.Validate(contextValue, assertion); err != nil {
		return app.VerifiedIdentity{}, fmt.Errorf("validate Identity access-token session: %w", err)
	}
	return app.VerifiedIdentity{PrincipalID: claims.Subject}, nil
}
