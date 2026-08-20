package httpadapter

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/authn"
	"github.com/aethercode/aethercode/services/identity/internal/app"
)

type fakeUseCases struct {
	registerEmail string
	registerToken string
}

func (fake *fakeUseCases) Register(_ context.Context, email, _, _, _, _ string) (string, string, error) {
	fake.registerEmail = email
	return "019b11a0-0000-7000-8000-000000000001", fake.registerToken, nil
}

func (fake *fakeUseCases) VerifyEmail(context.Context, string) (string, error) {
	return "019b11a0-0000-7000-8000-000000000001", nil
}

func (fake *fakeUseCases) Login(context.Context, string, string, string, string, string, string) (app.TokenPair, error) {
	return app.TokenPair{}, nil
}

func (fake *fakeUseCases) CompleteMFA(context.Context, string, string, string, string, string) (app.TokenPair, error) {
	return app.TokenPair{}, nil
}

func (fake *fakeUseCases) Refresh(context.Context, string, string, string, string) (app.TokenPair, error) {
	return app.TokenPair{}, nil
}

func (fake *fakeUseCases) Logout(context.Context, string) error { return nil }

func (fake *fakeUseCases) RequestPasswordReset(context.Context, string, string, string) (string, error) {
	return "reset-token", nil
}

func (fake *fakeUseCases) ResetPassword(context.Context, string, string, string, string) error {
	return nil
}

func (fake *fakeUseCases) BeginTOTP(context.Context, string, string) (string, string, error) {
	return "019b11a0-0000-7000-8000-000000000002", "ABCDEFGHIJKLMNOP", nil
}

func (fake *fakeUseCases) ActivateTOTP(context.Context, string, string, string) ([]string, error) {
	return []string{"ABCDEFGH-IJKLMNO"}, nil
}

func (fake *fakeUseCases) DisableTOTP(context.Context, string, string, string) error { return nil }

func (fake *fakeUseCases) ValidateAccessToken(context.Context, string, string) error { return nil }

func (fake *fakeUseCases) GetPrincipal(context.Context, string) (*app.Principal, error) {
	return nil, nil
}

func (fake *fakeUseCases) DeletePrincipal(context.Context, app.DeletePrincipal) error { return nil }

func (fake *fakeUseCases) HardDeletePrincipal(context.Context, app.DeletePrincipal) error {
	return nil
}

type fakeVerifier struct{}

func (fakeVerifier) Verify(string, time.Time) (authn.Claims, error) {
	return authn.Claims{Subject: "019b11a0-0000-7000-8000-000000000001"}, nil
}

func TestRegisterDoesNotExposeVerificationBearerOutsideDevelopment(t *testing.T) {
	t.Parallel()
	fake := &fakeUseCases{registerToken: "verification-bearer"}
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, false)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/register", strings.NewReader(`{"email":"user@example.com","display_name":"Ada","password":"AetherCode2026"}`))
	request.RemoteAddr = "127.0.0.1:1234"
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q", response.Header().Get("Cache-Control"))
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if _, found := body["verification_token"]; found {
		t.Fatalf("production response exposed verification bearer: %s", response.Body.String())
	}
	if fake.registerEmail != "user@example.com" {
		t.Fatalf("register email = %q", fake.registerEmail)
	}
}

func TestRegisterRejectsUnknownJSONFields(t *testing.T) {
	t.Parallel()
	fake := &fakeUseCases{}
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, true)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/register", strings.NewReader(`{"email":"user@example.com","display_name":"Ada","password":"AetherCode2026","unexpected":true}`))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestDevelopmentResetResponseIncludesBearerOnlyWhenEnabled(t *testing.T) {
	t.Parallel()
	fake := &fakeUseCases{}
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, true)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/password-reset", strings.NewReader(`{"email":"user@example.com"}`))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusAccepted || !strings.Contains(response.Body.String(), "reset-token") {
		t.Fatalf("response = %d %s", response.Code, response.Body.String())
	}
}
