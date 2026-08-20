// Package app contains the Identity service use cases.
package app

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/authn"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/services/identity/internal/domain"
)

var emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

// Store is the port implemented by Identity's persistence adapter.
type Store interface {
	Register(context.Context, Registration) error
	VerifyEmail(context.Context, []byte) (string, error)
	Authenticate(context.Context, Login) (Session, error)
	RotateRefresh(context.Context, RefreshRotation) (Session, error)
	RevokeRefresh(context.Context, []byte, string) error
	RequestPasswordReset(context.Context, PasswordResetRequest) error
	ResetPassword(context.Context, PasswordReset) error
	ValidateAccessToken(context.Context, string, string) error
	CreateMFAChallenge(context.Context, MFAChallenge) error
	CompleteMFAChallenge(context.Context, MFAChallengeCompletion) (Session, error)
	BeginTOTP(context.Context, TOTPEnrollment) error
	ActivateTOTP(context.Context, TOTPActivation) ([]string, error)
	DisableTOTP(context.Context, TOTPDisable) error
	GetPrincipal(context.Context, string) (*Principal, error)
	GetPrincipalIncludeDeleted(context.Context, string) (*Principal, error)
	SoftDeletePrincipal(context.Context, DeletePrincipal) error
	HardDeletePrincipal(context.Context, DeletePrincipal) error
	Ping(context.Context) error
}

// Registration is the persistence-safe registration command. Password and
// verification bearer values are hashed before reaching this boundary.
type Registration struct {
	PrincipalID           string
	Email                 string
	DisplayName           string
	PasswordHash          string
	VerificationTokenID   string
	VerificationTokenHash []byte
	VerificationExpiresAt time.Time
	RequestIP             string
	RequestID             string
}

// Login is a persistence-safe login command. The raw password remains in
// process memory only and is never included in logs, SQL strings, or events.
type Login struct {
	Email            string
	Password         string
	RefreshFamilyID  string
	RefreshTokenID   string
	RefreshTokenHash []byte
	RefreshExpiresAt time.Time
	AccessTokenID    string
	AccessExpiresAt  time.Time
	TenantID         string
	RequestIP        string
	UserAgent        string
	RequestID        string
	LockoutThreshold int
	LockoutDuration  time.Duration
}

// RefreshRotation atomically consumes one refresh token and creates its child.
type RefreshRotation struct {
	CurrentTokenHash []byte
	NewTokenID       string
	NewTokenHash     []byte
	NewExpiresAt     time.Time
	AccessTokenID    string
	AccessExpiresAt  time.Time
	RequestIP        string
	UserAgent        string
	RequestID        string
}

// Session is the durable result needed to issue an access assertion.
type Session struct {
	PrincipalID   string
	TenantID      string
	AuthzRevision int64
	MFARequired   bool
}

// PasswordResetRequest creates a reset record without persisting its bearer.
type PasswordResetRequest struct {
	TokenID   string
	Email     string
	TokenHash []byte
	ExpiresAt time.Time
	RequestIP string
	RequestID string
}

// PasswordReset applies a verified reset and revokes every active session.
type PasswordReset struct {
	TokenHash    []byte
	PasswordHash string
	RequestIP    string
	RequestID    string
}

// TOTPEnrollment carries a raw TOTP seed only in process memory between the
// application layer and Identity's encryption-owning repository adapter.
type TOTPEnrollment struct {
	FactorID    string
	PrincipalID string
	Label       string
	Secret      string
}

// TOTPActivation proves possession of a pending factor before it can enforce
// MFA at login. Recovery codes are returned once by the repository.
type TOTPActivation struct {
	PrincipalID string
	FactorID    string
	Code        string
}

// TOTPDisable requires an authenticated factor proof and removes the factor
// from future login policy without deleting its security history.
type TOTPDisable struct {
	PrincipalID string
	FactorID    string
	Code        string
}

// MFAChallenge is a one-time bearer hash created only after a correct
// password has been verified for a principal with at least one active factor.
type MFAChallenge struct {
	ID          string
	PrincipalID string
	TenantID    string
	TokenHash   []byte
	ExpiresAt   time.Time
	RequestIP   string
	UserAgent   string
	RequestID   string
}

// MFAChallengeCompletion carries the new session material only as hashes and
// UUIDs. The plaintext replacement refresh bearer never reaches storage.
type MFAChallengeCompletion struct {
	ChallengeTokenHash []byte
	Code               string
	RefreshFamilyID    string
	RefreshTokenID     string
	RefreshTokenHash   []byte
	RefreshExpiresAt   time.Time
	AccessTokenID      string
	AccessExpiresAt    time.Time
	RequestIP          string
	UserAgent          string
	RequestID          string
}

// Principal is the domain entity exposed by the service layer.
type Principal struct {
	ID                  string     `json:"id"`
	Email               string     `json:"email"`
	DisplayName         string     `json:"display_name"`
	Status              string     `json:"status"`
	EmailVerifiedAt     *time.Time `json:"email_verified_at,omitempty"`
	LastAuthenticatedAt *time.Time `json:"last_authenticated_at,omitempty"`
	Version             int        `json:"version"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
	DeletedAt           *time.Time `json:"deleted_at,omitempty"`
	DeletedBy           *string    `json:"deleted_by,omitempty"`
	DeletionReason      *string    `json:"deletion_reason,omitempty"`
}

// DeletePrincipal is the command for soft/hard delete operations.
type DeletePrincipal struct {
	ID      string
	ActorID string
	Reason  string
}

// TokenPair is returned only through the public HTTP adapter after successful
// authentication or refresh rotation.
type TokenPair struct {
	AccessToken           string    `json:"access_token"`
	AccessTokenExpiresAt  time.Time `json:"access_token_expires_at"`
	RefreshToken          string    `json:"refresh_token"`
	RefreshTokenExpiresAt time.Time `json:"refresh_token_expires_at"`
	MFARequired           bool      `json:"mfa_required,omitempty"`
	MFAChallengeToken     string    `json:"mfa_challenge_token,omitempty"`
	MFAChallengeExpiresAt time.Time `json:"mfa_challenge_expires_at,omitempty"`
}

// Service implements authentication flows with injected time and opaque token
// issuance to make business invariants deterministic in tests.
type Service struct {
	store                     Store
	signer                    *authn.Signer
	accessTokenLifetime       time.Duration
	refreshTokenLifetime      time.Duration
	emailVerificationLifetime time.Duration
	passwordResetLifetime     time.Duration
	mfaChallengeLifetime      time.Duration
	lockoutThreshold          int
	lockoutDuration           time.Duration
	deliveryTokenKey          []byte
	now                       func() time.Time
	newID                     func() (string, error)
	newOpaqueToken            func() (string, error)
	deriveDeliveryToken       func(string, string) (string, error)
}

// Options supplies validated runtime values to the identity use cases.
type Options struct {
	Signer                    *authn.Signer
	AccessTokenLifetime       time.Duration
	RefreshTokenLifetime      time.Duration
	EmailVerificationLifetime time.Duration
	PasswordResetLifetime     time.Duration
	MFAChallengeLifetime      time.Duration
	LockoutThreshold          int
	LockoutDuration           time.Duration
	DeliveryTokenKey          []byte
}

// NewService constructs the identity use-case service.
func NewService(store Store, options Options) (*Service, error) {
	if store == nil || options.Signer == nil {
		return nil, fmt.Errorf("identity store and access-token signer are required")
	}
	if options.AccessTokenLifetime <= 0 || options.RefreshTokenLifetime <= 0 ||
		options.EmailVerificationLifetime <= 0 || options.PasswordResetLifetime <= 0 || options.MFAChallengeLifetime <= 0 ||
		options.LockoutThreshold <= 0 || options.LockoutDuration <= 0 {
		return nil, fmt.Errorf("identity security options must be positive")
	}
	if len(options.DeliveryTokenKey) < 32 {
		return nil, fmt.Errorf("identity delivery-token HMAC key must contain at least 32 bytes")
	}
	deliveryTokenKey := append([]byte(nil), options.DeliveryTokenKey...)
	return &Service{
		store: store, signer: options.Signer,
		accessTokenLifetime: options.AccessTokenLifetime, refreshTokenLifetime: options.RefreshTokenLifetime,
		emailVerificationLifetime: options.EmailVerificationLifetime, passwordResetLifetime: options.PasswordResetLifetime,
		mfaChallengeLifetime: options.MFAChallengeLifetime,
		lockoutThreshold:     options.LockoutThreshold, lockoutDuration: options.LockoutDuration,
		deliveryTokenKey: deliveryTokenKey,
		now:              time.Now, newID: database.NewUUIDv7, newOpaqueToken: domain.NewOpaqueToken,
		deriveDeliveryToken: func(purpose, tokenID string) (string, error) {
			return domain.DeriveDeliveryToken(deliveryTokenKey, purpose, tokenID)
		},
	}, nil
}

// Register creates a pending-verification principal and returns the raw
// verification bearer only to the immediate trusted delivery path.
func (service *Service) Register(contextValue context.Context, email, displayName, password, requestIP, requestID string) (string, string, error) {
	email, displayName, err := validateRegistration(email, displayName, password)
	if err != nil {
		return "", "", err
	}
	passwordHash, err := domain.HashPassword(password)
	if err != nil {
		return "", "", apperrors.New(apperrors.CodeInvalidArgument, err.Error())
	}
	principalID, err := service.newID()
	if err != nil {
		return "", "", fmt.Errorf("create principal ID: %w", err)
	}
	verificationTokenID, err := service.newID()
	if err != nil {
		return "", "", fmt.Errorf("create verification token ID: %w", err)
	}
	verificationToken, err := service.deriveDeliveryToken("email-verification", verificationTokenID)
	if err != nil {
		return "", "", err
	}
	tokenHash := domain.HashToken(verificationToken)
	if err := service.store.Register(contextValue, Registration{
		PrincipalID: principalID, Email: email, DisplayName: displayName, PasswordHash: passwordHash,
		VerificationTokenID: verificationTokenID, VerificationTokenHash: tokenHash[:],
		VerificationExpiresAt: service.now().UTC().Add(service.emailVerificationLifetime),
		RequestIP:             strings.TrimSpace(requestIP), RequestID: strings.TrimSpace(requestID),
	}); err != nil {
		return "", "", err
	}
	return principalID, verificationToken, nil
}

// VerifyEmail activates a principal after a one-time verification bearer.
func (service *Service) VerifyEmail(contextValue context.Context, token string) (string, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return "", apperrors.New(apperrors.CodeInvalidArgument, "verification token is required")
	}
	hash := domain.HashToken(token)
	return service.store.VerifyEmail(contextValue, hash[:])
}

// Login authenticates a password and returns a rotated session pair.
func (service *Service) Login(contextValue context.Context, email, password, tenantID, requestIP, userAgent, requestID string) (TokenPair, error) {
	if email = normalizeEmail(email); !emailPattern.MatchString(email) || password == "" {
		return TokenPair{}, apperrors.New(apperrors.CodeUnauthorized, "invalid email or password")
	}
	tenantID = strings.ToLower(strings.TrimSpace(tenantID))
	if tenantID != "" && !isUUID(tenantID) {
		return TokenPair{}, apperrors.New(apperrors.CodeInvalidArgument, "tenant ID must be a UUID")
	}
	refreshToken, err := service.newOpaqueToken()
	if err != nil {
		return TokenPair{}, err
	}
	refreshHash := domain.HashToken(refreshToken)
	refreshFamilyID, err := service.newID()
	if err != nil {
		return TokenPair{}, err
	}
	refreshTokenID, err := service.newID()
	if err != nil {
		return TokenPair{}, err
	}
	accessTokenID, err := service.newID()
	if err != nil {
		return TokenPair{}, err
	}
	now := service.now().UTC()
	session, err := service.store.Authenticate(contextValue, Login{
		Email: email, Password: password, RefreshFamilyID: refreshFamilyID, RefreshTokenID: refreshTokenID,
		RefreshTokenHash: refreshHash[:], RefreshExpiresAt: now.Add(service.refreshTokenLifetime),
		AccessTokenID: accessTokenID, AccessExpiresAt: now.Add(service.accessTokenLifetime), TenantID: tenantID, RequestIP: strings.TrimSpace(requestIP),
		UserAgent: strings.TrimSpace(userAgent), RequestID: strings.TrimSpace(requestID),
		LockoutThreshold: service.lockoutThreshold, LockoutDuration: service.lockoutDuration,
	})
	if err != nil {
		return TokenPair{}, err
	}
	if session.MFARequired {
		challengeID, idErr := service.newID()
		if idErr != nil {
			return TokenPair{}, idErr
		}
		challengeToken, tokenErr := service.newOpaqueToken()
		if tokenErr != nil {
			return TokenPair{}, tokenErr
		}
		challengeHash := domain.HashToken(challengeToken)
		expiresAt := now.Add(service.mfaChallengeLifetime)
		if err := service.store.CreateMFAChallenge(contextValue, MFAChallenge{
			ID: challengeID, PrincipalID: session.PrincipalID, TenantID: session.TenantID,
			TokenHash: challengeHash[:], ExpiresAt: expiresAt, RequestIP: strings.TrimSpace(requestIP),
			UserAgent: strings.TrimSpace(userAgent), RequestID: strings.TrimSpace(requestID),
		}); err != nil {
			return TokenPair{}, err
		}
		return TokenPair{MFARequired: true, MFAChallengeToken: challengeToken, MFAChallengeExpiresAt: expiresAt}, nil
	}
	return service.issueTokenPair(session, accessTokenID, refreshToken, now)
}

// CompleteMFA completes a previously password-verified challenge and creates
// a fresh refresh family only after a valid current TOTP or recovery proof.
func (service *Service) CompleteMFA(contextValue context.Context, challengeToken, code, requestIP, userAgent, requestID string) (TokenPair, error) {
	challengeToken = strings.TrimSpace(challengeToken)
	code = strings.TrimSpace(code)
	if challengeToken == "" || code == "" {
		return TokenPair{}, apperrors.New(apperrors.CodeUnauthorized, "MFA challenge is invalid")
	}
	refreshToken, err := service.newOpaqueToken()
	if err != nil {
		return TokenPair{}, err
	}
	refreshHash := domain.HashToken(refreshToken)
	refreshFamilyID, err := service.newID()
	if err != nil {
		return TokenPair{}, err
	}
	refreshTokenID, err := service.newID()
	if err != nil {
		return TokenPair{}, err
	}
	accessTokenID, err := service.newID()
	if err != nil {
		return TokenPair{}, err
	}
	challengeHash := domain.HashToken(challengeToken)
	now := service.now().UTC()
	session, err := service.store.CompleteMFAChallenge(contextValue, MFAChallengeCompletion{
		ChallengeTokenHash: challengeHash[:], Code: code, RefreshFamilyID: refreshFamilyID,
		RefreshTokenID: refreshTokenID, RefreshTokenHash: refreshHash[:],
		RefreshExpiresAt: now.Add(service.refreshTokenLifetime), AccessTokenID: accessTokenID,
		AccessExpiresAt: now.Add(service.accessTokenLifetime),
		RequestIP:       strings.TrimSpace(requestIP), UserAgent: strings.TrimSpace(userAgent), RequestID: strings.TrimSpace(requestID),
	})
	if err != nil {
		return TokenPair{}, err
	}
	return service.issueTokenPair(session, accessTokenID, refreshToken, now)
}

// Refresh atomically rotates a refresh bearer and detects replay in the store.
func (service *Service) Refresh(contextValue context.Context, refreshToken, requestIP, userAgent, requestID string) (TokenPair, error) {
	if strings.TrimSpace(refreshToken) == "" {
		return TokenPair{}, apperrors.New(apperrors.CodeUnauthorized, "refresh token is required")
	}
	newRefreshToken, err := service.newOpaqueToken()
	if err != nil {
		return TokenPair{}, err
	}
	currentHash := domain.HashToken(refreshToken)
	newHash := domain.HashToken(newRefreshToken)
	newTokenID, err := service.newID()
	if err != nil {
		return TokenPair{}, err
	}
	accessTokenID, err := service.newID()
	if err != nil {
		return TokenPair{}, err
	}
	now := service.now().UTC()
	session, err := service.store.RotateRefresh(contextValue, RefreshRotation{
		CurrentTokenHash: currentHash[:], NewTokenID: newTokenID, NewTokenHash: newHash[:],
		NewExpiresAt: now.Add(service.refreshTokenLifetime), AccessTokenID: accessTokenID,
		AccessExpiresAt: now.Add(service.accessTokenLifetime),
		RequestIP:       strings.TrimSpace(requestIP), UserAgent: strings.TrimSpace(userAgent), RequestID: strings.TrimSpace(requestID),
	})
	if err != nil {
		return TokenPair{}, err
	}
	return service.issueTokenPair(session, accessTokenID, newRefreshToken, now)
}

// Logout revokes the family containing the supplied refresh bearer.
func (service *Service) Logout(contextValue context.Context, refreshToken string) error {
	if strings.TrimSpace(refreshToken) == "" {
		return apperrors.New(apperrors.CodeInvalidArgument, "refresh token is required")
	}
	hash := domain.HashToken(refreshToken)
	return service.store.RevokeRefresh(contextValue, hash[:], "logout")
}

// RequestPasswordReset creates an opaque reset bearer. The HTTP adapter may
// expose it only in development/test; production delivery happens out of band.
func (service *Service) RequestPasswordReset(contextValue context.Context, email, requestIP, requestID string) (string, error) {
	email = normalizeEmail(email)
	if !emailPattern.MatchString(email) {
		return "", apperrors.New(apperrors.CodeInvalidArgument, "email is invalid")
	}
	id, err := service.newID()
	if err != nil {
		return "", err
	}
	token, err := service.deriveDeliveryToken("password-reset", id)
	if err != nil {
		return "", err
	}
	hash := domain.HashToken(token)
	if err := service.store.RequestPasswordReset(contextValue, PasswordResetRequest{
		TokenID: id, Email: email, TokenHash: hash[:], ExpiresAt: service.now().UTC().Add(service.passwordResetLifetime),
		RequestIP: strings.TrimSpace(requestIP), RequestID: strings.TrimSpace(requestID),
	}); err != nil {
		return "", err
	}
	return token, nil
}

// ResetPassword consumes an opaque reset bearer, changes the password, and
// invalidates all refresh sessions for the affected principal.
func (service *Service) ResetPassword(contextValue context.Context, token, password, requestIP, requestID string) error {
	if strings.TrimSpace(token) == "" {
		return apperrors.New(apperrors.CodeInvalidArgument, "reset token is required")
	}
	passwordHash, err := domain.HashPassword(password)
	if err != nil {
		return apperrors.New(apperrors.CodeInvalidArgument, err.Error())
	}
	hash := domain.HashToken(token)
	return service.store.ResetPassword(contextValue, PasswordReset{
		TokenHash: hash[:], PasswordHash: passwordHash, RequestIP: strings.TrimSpace(requestIP), RequestID: strings.TrimSpace(requestID),
	})
}

// ValidateAccessToken checks the durable session state after cryptographic JWS
// validation. Logout, reset, and MFA changes therefore take effect before a
// short-lived access assertion naturally expires.
func (service *Service) ValidateAccessToken(contextValue context.Context, principalID, tokenID string) error {
	principalID = strings.ToLower(strings.TrimSpace(principalID))
	tokenID = strings.ToLower(strings.TrimSpace(tokenID))
	if !isUUID(principalID) || !isUUID(tokenID) {
		return apperrors.New(apperrors.CodeUnauthorized, "access token is invalid")
	}
	return service.store.ValidateAccessToken(contextValue, principalID, tokenID)
}

// BeginTOTP creates a pending encrypted factor and returns its one-time seed
// only to the authenticated principal so a client can render a QR URI locally.
func (service *Service) BeginTOTP(contextValue context.Context, principalID, label string) (string, string, error) {
	principalID = strings.ToLower(strings.TrimSpace(principalID))
	label = strings.TrimSpace(label)
	if !isUUID(principalID) {
		return "", "", apperrors.New(apperrors.CodeUnauthorized, "authenticated principal is invalid")
	}
	if length := len([]rune(label)); length < 1 || length > 120 {
		return "", "", apperrors.New(apperrors.CodeInvalidArgument, "factor label must contain between 1 and 120 characters")
	}
	factorID, err := service.newID()
	if err != nil {
		return "", "", err
	}
	secret, err := domain.NewTOTPSecret()
	if err != nil {
		return "", "", err
	}
	if err := service.store.BeginTOTP(contextValue, TOTPEnrollment{
		FactorID: factorID, PrincipalID: principalID, Label: label, Secret: secret,
	}); err != nil {
		return "", "", err
	}
	return factorID, secret, nil
}

// ActivateTOTP verifies a pending factor and returns one-time recovery codes.
func (service *Service) ActivateTOTP(contextValue context.Context, principalID, factorID, code string) ([]string, error) {
	principalID = strings.ToLower(strings.TrimSpace(principalID))
	factorID = strings.ToLower(strings.TrimSpace(factorID))
	if !isUUID(principalID) || !isUUID(factorID) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "principal and factor IDs must be UUIDs")
	}
	if !validTOTPCode(code) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "TOTP code must contain six digits")
	}
	return service.store.ActivateTOTP(contextValue, TOTPActivation{PrincipalID: principalID, FactorID: factorID, Code: code})
}

// DisableTOTP deactivates a factor after one valid current TOTP proof.
func (service *Service) DisableTOTP(contextValue context.Context, principalID, factorID, code string) error {
	principalID = strings.ToLower(strings.TrimSpace(principalID))
	factorID = strings.ToLower(strings.TrimSpace(factorID))
	if !isUUID(principalID) || !isUUID(factorID) {
		return apperrors.New(apperrors.CodeInvalidArgument, "principal and factor IDs must be UUIDs")
	}
	if !validTOTPCode(code) {
		return apperrors.New(apperrors.CodeInvalidArgument, "TOTP code must contain six digits")
	}
	return service.store.DisableTOTP(contextValue, TOTPDisable{PrincipalID: principalID, FactorID: factorID, Code: code})
}

func (service *Service) issueTokenPair(session Session, accessTokenID, refreshToken string, now time.Time) (TokenPair, error) {
	if session.PrincipalID == "" || accessTokenID == "" {
		return TokenPair{}, fmt.Errorf("identity store returned an incomplete session")
	}
	accessToken, claims, err := service.signer.Issue(session.PrincipalID, accessTokenID, now, service.accessTokenLifetime)
	if err != nil {
		return TokenPair{}, fmt.Errorf("issue access token: %w", err)
	}
	return TokenPair{
		AccessToken: accessToken, AccessTokenExpiresAt: time.Unix(claims.ExpiresAt, 0).UTC(),
		RefreshToken: refreshToken, RefreshTokenExpiresAt: now.Add(service.refreshTokenLifetime),
	}, nil
}

func validateRegistration(email, displayName, password string) (string, string, error) {
	email = normalizeEmail(email)
	displayName = strings.TrimSpace(displayName)
	if !emailPattern.MatchString(email) {
		return "", "", apperrors.New(apperrors.CodeInvalidArgument, "email is invalid")
	}
	if length := len([]rune(displayName)); length < 1 || length > 200 {
		return "", "", apperrors.New(apperrors.CodeInvalidArgument, "display name must contain between 1 and 200 characters")
	}
	if err := domain.ValidatePassword(password); err != nil {
		return "", "", apperrors.New(apperrors.CodeInvalidArgument, err.Error())
	}
	return email, displayName, nil
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func isUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, character := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			if character != '-' {
				return false
			}
			continue
		}
		//nolint:staticcheck // QF1001: the negated-range form reads more clearly for character validation
		if !(character >= '0' && character <= '9') && !(character >= 'a' && character <= 'f') {
			return false
		}
	}
	return true
}

func validTOTPCode(code string) bool {
	code = strings.TrimSpace(code)
	if len(code) != 6 {
		return false
	}
	for _, character := range code {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

// GetPrincipal retrieves an active (non-deleted) principal by ID.
func (service *Service) GetPrincipal(contextValue context.Context, principalID string) (*Principal, error) {
	principalID = strings.ToLower(strings.TrimSpace(principalID))
	if !isUUID(principalID) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "principal ID must be a UUID")
	}
	return service.store.GetPrincipal(contextValue, principalID)
}

// DeletePrincipal performs soft delete on a principal with audit trail.
// Authorization is enforced at the HTTP layer and domain layer.
func (service *Service) DeletePrincipal(contextValue context.Context, command DeletePrincipal) error {
	command.Reason = strings.TrimSpace(command.Reason)
	command.ID = strings.ToLower(strings.TrimSpace(command.ID))
	command.ActorID = strings.ToLower(strings.TrimSpace(command.ActorID))

	if !isUUID(command.ID) || !isUUID(command.ActorID) || command.Reason == "" {
		return apperrors.New(apperrors.CodeInvalidArgument, "principal ID, actor ID, and deletion reason are required")
	}

	// Verify principal exists before attempting soft delete
	_, err := service.store.GetPrincipal(contextValue, command.ID)
	if err != nil {
		return fmt.Errorf("get principal: %w", err)
	}

	return service.store.SoftDeletePrincipal(contextValue, command)
}

// HardDeletePrincipal permanently removes a principal (SuperAdmin only).
// Authorization is enforced at both HTTP layer and domain layer.
func (service *Service) HardDeletePrincipal(contextValue context.Context, command DeletePrincipal) error {
	command.Reason = strings.TrimSpace(command.Reason)
	command.ID = strings.ToLower(strings.TrimSpace(command.ID))
	command.ActorID = strings.ToLower(strings.TrimSpace(command.ActorID))

	if !isUUID(command.ID) || !isUUID(command.ActorID) || command.Reason == "" {
		return apperrors.New(apperrors.CodeInvalidArgument, "principal ID, actor ID, and deletion reason are required")
	}

	// Verify principal exists (including soft-deleted)
	_, err := service.store.GetPrincipalIncludeDeleted(contextValue, command.ID)
	if err != nil {
		return fmt.Errorf("get principal: %w", err)
	}

	return service.store.HardDeletePrincipal(contextValue, command)
}
