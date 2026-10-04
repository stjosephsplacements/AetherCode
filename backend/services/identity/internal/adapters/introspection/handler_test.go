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
	"github.com/aethercode/aethercode/services/identity/internal/app"
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

type fakeAccounts struct {
	requests []app.AccountRequest
	audit    app.AccountAudit
	status   string
}

func (accounts *fakeAccounts) ProvisionAccounts(_ context.Context, requests []app.AccountRequest, audit app.AccountAudit) ([]app.IssuedCredential, error) {
	accounts.requests, accounts.audit = requests, audit
	return []app.IssuedCredential{{PrincipalID: introspectionTestPrincipal, Username: requests[0].Username, Password: "generated2345"}}, nil
}

func (accounts *fakeAccounts) ReissuePasswords(context.Context, []string, app.AccountAudit) ([]app.IssuedCredential, error) {
	return nil, nil
}

func (accounts *fakeAccounts) SetAccountStatus(_ context.Context, _ []string, status string, audit app.AccountAudit) error {
	accounts.status, accounts.audit = status, audit
	return nil
}

func (accounts *fakeAccounts) DiscardAccounts(context.Context, []string, app.AccountAudit) error {
	return nil
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
	handler, err := NewHandler(service, &fakeAccounts{}, fakeAccessVerifier{claims: authn.Claims{
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
			handler, err := NewHandler(service, &fakeAccounts{}, scenario.verifier, "spiffe://aethercode/user", scenario.mtls)
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

func TestProvisionAccountsReturnsCredentialsOnce(t *testing.T) {
	t.Parallel()
	accounts := &fakeAccounts{}
	handler, err := NewHandler(&fakeValidationService{}, accounts, fakeAccessVerifier{}, "", false)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	body := `{"actor_id":"` + introspectionTestPrincipal + `","request_id":"` + introspectionTestTokenID +
		`","accounts":[{"username":"22cs001","display_name":"Asha Kumar"}]}`
	request := httptest.NewRequest(http.MethodPost, "/v1/internal/accounts", strings.NewReader(body))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusCreated, response.Body)
	}
	if accounts.audit.ActorID != introspectionTestPrincipal || accounts.audit.RequestID != introspectionTestTokenID {
		t.Fatalf("audit = %#v", accounts.audit)
	}
	if len(accounts.requests) != 1 || accounts.requests[0].Username != "22cs001" || accounts.requests[0].DisplayName != "Asha Kumar" {
		t.Fatalf("requests = %#v", accounts.requests)
	}
	if !strings.Contains(response.Body.String(), `"password":"generated2345"`) || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("response = %s (Cache-Control %q)", response.Body, response.Header().Get("Cache-Control"))
	}
}

func TestAccountEndpointsRequireTrustedPeer(t *testing.T) {
	t.Parallel()
	for _, path := range []string{"/v1/internal/accounts", "/v1/internal/accounts/passwords", "/v1/internal/accounts/status", "/v1/internal/accounts/discard"} {
		accounts := &fakeAccounts{}
		handler, err := NewHandler(&fakeValidationService{}, accounts, fakeAccessVerifier{}, "spiffe://aethercode/user", true)
		if err != nil {
			t.Fatalf("NewHandler() error = %v", err)
		}
		request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"status":"disabled"}`))
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusForbidden || accounts.status != "" {
			t.Fatalf("%s: status = %d, want 403 without reaching the use case", path, response.Code)
		}
	}
}
