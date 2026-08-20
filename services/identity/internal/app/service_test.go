package app

import (
	"context"
	"crypto/ed25519"
	"testing"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/authn"
	"github.com/aethercode/aethercode/services/identity/internal/domain"
)

const (
	testPrincipalID = "019b11a0-0000-7000-8000-000000000001"
	testFamilyID    = "019b11a0-0000-7000-8000-000000000002"
	testTokenID     = "019b11a0-0000-7000-8000-000000000003"
	testAccessID    = "019b11a0-0000-7000-8000-000000000004"
)

type memoryStore struct {
	registration Registration
	login        Login
	rotation     RefreshRotation
	resetRequest PasswordResetRequest
	reset        PasswordReset
	mfaChallenge MFAChallenge
	session      Session
}

func (store *memoryStore) Register(_ context.Context, command Registration) error {
	store.registration = command
	return nil
}

func (store *memoryStore) VerifyEmail(_ context.Context, _ []byte) (string, error) {
	return testPrincipalID, nil
}

func (store *memoryStore) Authenticate(_ context.Context, command Login) (Session, error) {
	store.login = command
	return store.session, nil
}

func (store *memoryStore) RotateRefresh(_ context.Context, command RefreshRotation) (Session, error) {
	store.rotation = command
	return store.session, nil
}

func (store *memoryStore) RevokeRefresh(_ context.Context, _ []byte, _ string) error { return nil }

func (store *memoryStore) RequestPasswordReset(_ context.Context, command PasswordResetRequest) error {
	store.resetRequest = command
	return nil
}

func (store *memoryStore) ResetPassword(_ context.Context, command PasswordReset) error {
	store.reset = command
	return nil
}

func (store *memoryStore) ValidateAccessToken(context.Context, string, string) error { return nil }

func (store *memoryStore) CreateMFAChallenge(_ context.Context, command MFAChallenge) error {
	store.mfaChallenge = command
	return nil
}

func (store *memoryStore) CompleteMFAChallenge(_ context.Context, _ MFAChallengeCompletion) (Session, error) {
	return store.session, nil
}

func (store *memoryStore) BeginTOTP(context.Context, TOTPEnrollment) error { return nil }

func (store *memoryStore) ActivateTOTP(context.Context, TOTPActivation) ([]string, error) {
	return []string{"ABCDEFGH-IJKLMNO"}, nil
}

func (store *memoryStore) DisableTOTP(context.Context, TOTPDisable) error { return nil }

func (store *memoryStore) GetPrincipal(context.Context, string) (*Principal, error) {
	return nil, nil
}

func (store *memoryStore) GetPrincipalIncludeDeleted(context.Context, string) (*Principal, error) {
	return nil, nil
}

func (store *memoryStore) SoftDeletePrincipal(context.Context, DeletePrincipal) error {
	return nil
}

func (store *memoryStore) HardDeletePrincipal(context.Context, DeletePrincipal) error {
	return nil
}

func (store *memoryStore) Ping(context.Context) error { return nil }

func TestRegisterHashesPasswordAndVerificationBearer(t *testing.T) {
	t.Parallel()
	store := &memoryStore{}
	service := newTestService(t, store)
	service.newID = sequentialIDs(testPrincipalID, testTokenID)
	service.deriveDeliveryToken = func(_, _ string) (string, error) { return "verification-bearer", nil }
	principalID, token, err := service.Register(
		context.Background(), " USER@example.com ", "  Ada Lovelace ", "AetherCode2026", "127.0.0.1", testAccessID,
	)
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}
	if principalID != testPrincipalID || token != "verification-bearer" {
		t.Fatalf("Register() = (%q, %q), want generated principal and bearer", principalID, token)
	}
	if store.registration.Email != "user@example.com" || store.registration.DisplayName != "Ada Lovelace" {
		t.Fatalf("registration normalization = %#v", store.registration)
	}
	if store.registration.PasswordHash == "AetherCode2026" || !domain.VerifyPassword(store.registration.PasswordHash, "AetherCode2026") {
		t.Fatal("Register() did not persist an Argon2id password hash")
	}
	expected := domain.HashToken(token)
	if string(store.registration.VerificationTokenHash) != string(expected[:]) {
		t.Fatal("Register() did not pass the verification-token hash to storage")
	}
}

func TestLoginIssuesVerifiableAccessTokenAndOpaqueRefreshBearer(t *testing.T) {
	t.Parallel()
	store := &memoryStore{session: Session{PrincipalID: testPrincipalID, AuthzRevision: 1}}
	service := newTestService(t, store)
	service.newID = sequentialIDs(testFamilyID, testTokenID, testAccessID)
	service.newOpaqueToken = func() (string, error) { return "refresh-bearer", nil }
	now := time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	pair, err := service.Login(context.Background(), "user@example.com", "AetherCode2026", "", "127.0.0.1", "test-agent", testAccessID)
	if err != nil {
		t.Fatalf("Login() error = %v", err)
	}
	if pair.RefreshToken != "refresh-bearer" || pair.AccessToken == "" {
		t.Fatalf("Login() token pair = %#v", pair)
	}
	expectedRefresh := domain.HashToken("refresh-bearer")
	if string(store.login.RefreshTokenHash) != string(expectedRefresh[:]) {
		t.Fatal("Login() passed a raw refresh bearer to storage")
	}
	if store.login.RefreshFamilyID != testFamilyID || store.login.RefreshTokenID != testTokenID || store.login.AccessTokenID != testAccessID {
		t.Fatalf("Login() session identifiers = %#v", store.login)
	}
	publicKey := service.signerPublicKey(t)
	verifier, err := authn.NewVerifier("https://identity.test", "aethercode-api", map[string]ed25519.PublicKey{"identity-test": publicKey}, 15*time.Minute, 0)
	if err != nil {
		t.Fatalf("NewVerifier() error = %v", err)
	}
	claims, err := verifier.Verify(pair.AccessToken, now)
	if err != nil {
		t.Fatalf("Verify(access token) error = %v", err)
	}
	if claims.Subject != testPrincipalID || claims.TokenID != testAccessID {
		t.Fatalf("access claims = %#v", claims)
	}
}

func TestLoginRejectsMalformedTenantBeforeStorage(t *testing.T) {
	t.Parallel()
	store := &memoryStore{session: Session{PrincipalID: testPrincipalID, AuthzRevision: 1}}
	service := newTestService(t, store)
	if _, err := service.Login(context.Background(), "user@example.com", "AetherCode2026", "not-a-uuid", "", "", ""); err == nil {
		t.Fatal("Login() accepted a malformed tenant ID")
	}
	if store.login.Email != "" {
		t.Fatal("Login() invoked storage after tenant validation failure")
	}
}

func TestLoginReturnsOneTimeMFAChallengeInsteadOfSessionWhenRequired(t *testing.T) {
	t.Parallel()
	store := &memoryStore{session: Session{PrincipalID: testPrincipalID, AuthzRevision: 1, MFARequired: true}}
	service := newTestService(t, store)
	service.newID = sequentialIDs(testFamilyID, testTokenID, testAccessID, "019b11a0-0000-7000-8000-000000000005")
	tokens := []string{"unused-refresh-bearer", "mfa-challenge-bearer"}
	service.newOpaqueToken = func() (string, error) {
		value := tokens[0]
		tokens = tokens[1:]
		return value, nil
	}
	now := time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	pair, err := service.Login(context.Background(), "user@example.com", "AetherCode2026", "", "127.0.0.1", "test-agent", testAccessID)
	if err != nil {
		t.Fatalf("Login() error = %v", err)
	}
	if !pair.MFARequired || pair.MFAChallengeToken != "mfa-challenge-bearer" || pair.AccessToken != "" || pair.RefreshToken != "" {
		t.Fatalf("MFA login result = %#v", pair)
	}
	expected := domain.HashToken(pair.MFAChallengeToken)
	if string(store.mfaChallenge.TokenHash) != string(expected[:]) {
		t.Fatal("Login() passed a raw MFA challenge bearer to storage")
	}
	if !store.mfaChallenge.ExpiresAt.Equal(now.Add(5 * time.Minute)) {
		t.Fatalf("MFA challenge expiry = %s", store.mfaChallenge.ExpiresAt)
	}
}

func newTestService(t *testing.T, store *memoryStore) *Service {
	t.Helper()
	seed := make([]byte, ed25519.SeedSize)
	for index := range seed {
		seed[index] = byte(index + 1)
	}
	signer, err := authn.NewSigner("https://identity.test", "aethercode-api", "identity-test", ed25519.NewKeyFromSeed(seed))
	if err != nil {
		t.Fatalf("NewSigner() error = %v", err)
	}
	service, err := NewService(store, Options{
		Signer: signer, AccessTokenLifetime: 15 * time.Minute, RefreshTokenLifetime: 24 * time.Hour,
		EmailVerificationLifetime: time.Hour, PasswordResetLifetime: time.Hour,
		MFAChallengeLifetime: 5 * time.Minute, LockoutThreshold: 5, LockoutDuration: 15 * time.Minute, DeliveryTokenKey: make([]byte, 32),
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	return service
}

func sequentialIDs(values ...string) func() (string, error) {
	index := 0
	return func() (string, error) {
		if index >= len(values) {
			return "", nil
		}
		value := values[index]
		index++
		return value, nil
	}
}

func (service *Service) signerPublicKey(t *testing.T) ed25519.PublicKey {
	t.Helper()
	// The test signer is deterministically derived in newTestService.
	seed := make([]byte, ed25519.SeedSize)
	for index := range seed {
		seed[index] = byte(index + 1)
	}
	return ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey)
}
