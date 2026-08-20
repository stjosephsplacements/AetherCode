package introspection

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/authn"
)

const (
	introspectionTestPrincipal = "018f4b0d-08f8-7c09-9ba7-efdf9c223355"
	introspectionTestTokenID   = "018f4b0d-08f8-7c09-9ba7-efdf9c223366"
)

type fakeValidationService struct {
	subject string
	tokenID string
	err     error
}

func (service *fakeValidationService) ValidateAccessToken(_ context.Context, subject, tokenID string) error {
	service.subject, service.tokenID = subject, tokenID
	return service.err
}

type fakeAccessVerifier struct {
	claims authn.Claims
	err    error
}

func (verifier fakeAccessVerifier) Verify(string, time.Time) (authn.Claims, error) {
	return verifier.claims, verifier.err
}

func TestValidateAccessTokenChecksSignedClaimsAndLiveSession(t *testing.T) {
	t.Parallel()
	service := &fakeValidationService{}
	handler, err := NewHandler(service, fakeAccessVerifier{claims: authn.Claims{
		Subject: introspectionTestPrincipal, TokenID: introspectionTestTokenID,
	}}, "", false)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/internal/access-token/validate", strings.NewReader(`{"access_token":"signed"}`))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNoContent)
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", response.Header().Get("Cache-Control"))
	}
	if service.subject != introspectionTestPrincipal || service.tokenID != introspectionTestTokenID {
		t.Fatalf("live validation received %q/%q", service.subject, service.tokenID)
	}
}

func TestValidateAccessTokenFailsClosed(t *testing.T) {
	t.Parallel()
	for _, scenario := range []struct {
		name       string
		verifier   fakeAccessVerifier
		serviceErr error
		mtls       bool
	}{
		{name: "invalid signature", verifier: fakeAccessVerifier{err: errors.New("bad signature")}},
		{name: "revoked session", verifier: fakeAccessVerifier{claims: authn.Claims{Subject: introspectionTestPrincipal, TokenID: introspectionTestTokenID}}, serviceErr: errors.New("revoked")},
		{name: "missing trusted peer", verifier: fakeAccessVerifier{claims: authn.Claims{Subject: introspectionTestPrincipal, TokenID: introspectionTestTokenID}}, mtls: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			service := &fakeValidationService{err: scenario.serviceErr}
			handler, err := NewHandler(service, scenario.verifier, "spiffe://aethercode/user", scenario.mtls)
			if err != nil {
				t.Fatalf("NewHandler() error = %v", err)
			}
			request := httptest.NewRequest(http.MethodPost, "/v1/internal/access-token/validate", strings.NewReader(`{"access_token":"signed"}`))
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusUnauthorized && response.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want fail-closed 401/403", response.Code)
			}
		})
	}
}
