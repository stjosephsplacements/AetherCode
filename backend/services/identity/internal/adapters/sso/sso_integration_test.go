//go:build zitadel

package sso

import (
	"context"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/aethercode/aethercode/services/identity/internal/app"
	"github.com/aethercode/aethercode/services/identity/internal/domain"
)

// TestDirectoryAgainstZitadel runs against a real ZITADEL with the argon2
// verifier enabled (ADR-0042): ZITADEL_TEST_URL, ZITADEL_TEST_PAT_FILE (an
// IAM owner's token) and ZITADEL_TEST_ORG_ID. It proves AetherCode's Argon2id
// hash signs the user in at the provider, and that a second sync links
// instead of duplicating.
func TestDirectoryAgainstZitadel(t *testing.T) {
	issuer, patFile, orgID := os.Getenv("ZITADEL_TEST_URL"), os.Getenv("ZITADEL_TEST_PAT_FILE"), os.Getenv("ZITADEL_TEST_ORG_ID")
	if issuer == "" || patFile == "" || orgID == "" {
		t.Skip("ZITADEL_TEST_URL, ZITADEL_TEST_PAT_FILE and ZITADEL_TEST_ORG_ID are not set")
	}
	provider := New(Config{Issuer: issuer, ClientID: "x", ClientSecret: "x", RedirectURI: "x",
		AdminTokenFile: patFile, OrganizationID: orgID, EmailDomain: "students.example.invalid"})
	ctx := context.Background()

	hash, err := domain.HashPassword("Practice2026ab")
	if err != nil {
		t.Fatal(err)
	}
	account := app.DirectoryAccount{Username: "21cs001", DisplayName: "Asha Kumar Rao", PasswordHash: hash}
	if found, err := provider.FindUser(ctx, account.Username); err != nil || found != "" {
		t.Fatalf("FindUser(before) = %q, %v; want none", found, err)
	}
	userID, err := provider.CreateUser(ctx, account)
	if err != nil || userID == "" {
		t.Fatalf("CreateUser = %q, %v", userID, err)
	}
	if found, err := provider.FindUser(ctx, "21CS001"); err != nil || found != userID {
		t.Fatalf("FindUser(after) = %q, %v; want %q", found, err, userID)
	}
	checkPassword(t, provider, account.Username, "Practice2026ab", true)
	checkPassword(t, provider, account.Username, "wrong-password-1", false)

	changed, err := domain.HashPassword("Changed2026xyz")
	if err != nil {
		t.Fatal(err)
	}
	account.PasswordHash, account.DisplayName = changed, "Asha Rao"
	if err := provider.UpdateUser(ctx, userID, account); err != nil {
		t.Fatalf("UpdateUser: %v", err)
	}
	checkPassword(t, provider, account.Username, "Changed2026xyz", true)
	checkPassword(t, provider, account.Username, "Practice2026ab", false)
}

// checkPassword signs in through ZITADEL's session API.
func checkPassword(t *testing.T, provider *Provider, username, password string, want bool) {
	t.Helper()
	headers, err := provider.adminHeaders()
	if err != nil {
		t.Fatal(err)
	}
	body := map[string]any{"checks": map[string]any{
		"user":     map[string]any{"loginName": username},
		"password": map[string]any{"password": password},
	}}
	err = provider.do(context.Background(), http.MethodPost, provider.config.Issuer+"/v2/sessions", headers, body, nil)
	if (err == nil) != want {
		t.Fatalf("password %q accepted = %v, want %v (%v)", password, err == nil, want, err)
	}
}

// TestSignInAgainstZitadel runs a real authorization-code flow: Start, the
// provider's authorization request finished with a password session (as its
// login UI does), then Identify with the returned code.
func TestSignInAgainstZitadel(t *testing.T) {
	issuer, patFile, orgID := os.Getenv("ZITADEL_TEST_URL"), os.Getenv("ZITADEL_TEST_PAT_FILE"), os.Getenv("ZITADEL_TEST_ORG_ID")
	if issuer == "" || patFile == "" || orgID == "" {
		t.Skip("ZITADEL_TEST_URL, ZITADEL_TEST_PAT_FILE and ZITADEL_TEST_ORG_ID are not set")
	}
	ctx := context.Background()
	// Unique per run, so the test can run again on the same ZITADEL.
	run := strconv.FormatInt(time.Now().UnixNano()%1_000_000, 10)
	username := "22it" + run
	admin := New(Config{Issuer: issuer, ClientID: "x", ClientSecret: "x", RedirectURI: "x",
		AdminTokenFile: patFile, OrganizationID: orgID, EmailDomain: "students.example.invalid"})
	headers, err := admin.adminHeaders()
	if err != nil {
		t.Fatal(err)
	}
	var project struct {
		ID string `json:"id"`
	}
	if err := admin.do(ctx, http.MethodPost, issuer+"/management/v1/projects", headers, map[string]any{"name": "AetherCode SSO test " + run}, &project); err != nil {
		t.Fatalf("create project: %v", err)
	}
	redirect := "http://localhost/auth/sso/callback"
	var client struct {
		ClientID     string `json:"clientId"`
		ClientSecret string `json:"clientSecret"`
	}
	if err := admin.do(ctx, http.MethodPost, issuer+"/management/v1/projects/"+project.ID+"/apps/oidc", headers, map[string]any{
		"name": "aethercode", "redirectUris": []string{redirect}, "responseTypes": []string{"OIDC_RESPONSE_TYPE_CODE"},
		"grantTypes": []string{"OIDC_GRANT_TYPE_AUTHORIZATION_CODE"}, "appType": "OIDC_APP_TYPE_WEB",
		"authMethodType": "OIDC_AUTH_METHOD_TYPE_BASIC", "devMode": true,
		"loginVersion": map[string]any{"loginV2": map[string]any{"baseUri": "http://localhost/login"}},
	}, &client); err != nil {
		t.Fatalf("create OIDC app: %v", err)
	}

	hash, err := domain.HashPassword("SignIn2026abc")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := admin.CreateUser(ctx, app.DirectoryAccount{Username: username, DisplayName: "Ravi S", PasswordHash: hash}); err != nil {
		t.Fatalf("create user: %v", err)
	}

	provider := New(Config{Issuer: issuer, ClientID: client.ClientID, ClientSecret: client.ClientSecret, RedirectURI: redirect})
	start, err := provider.Start(ctx)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	noRedirect := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := noRedirect.Get(start.AuthorizationURL)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	login, err := url.Parse(response.Header.Get("Location"))
	if err != nil || login.Query().Get("authRequest") == "" {
		t.Fatalf("authorization did not redirect to the login UI: %d %q", response.StatusCode, response.Header.Get("Location"))
	}
	var session struct {
		SessionID    string `json:"sessionId"`
		SessionToken string `json:"sessionToken"`
	}
	if err := admin.do(ctx, http.MethodPost, issuer+"/v2/sessions", headers, map[string]any{"checks": map[string]any{
		"user": map[string]any{"loginName": username}, "password": map[string]any{"password": "SignIn2026abc"},
	}}, &session); err != nil {
		t.Fatalf("create session: %v", err)
	}
	var finished struct {
		CallbackURL string `json:"callbackUrl"`
	}
	if err := admin.do(ctx, http.MethodPost, issuer+"/v2/oidc/auth_requests/"+login.Query().Get("authRequest"), headers,
		map[string]any{"session": map[string]any{"sessionId": session.SessionID, "sessionToken": session.SessionToken}}, &finished); err != nil {
		t.Fatalf("finish auth request: %v", err)
	}
	callback, err := url.Parse(finished.CallbackURL)
	if err != nil || callback.Query().Get("state") != start.State || callback.Query().Get("code") == "" {
		t.Fatalf("callback %q does not carry the state and a code", finished.CallbackURL)
	}

	if _, err := provider.Identify(ctx, callback.Query().Get("code"), "wrong-verifier-wrong-verifier-wrong-verifier"); err == nil {
		t.Fatal("Identify accepted a wrong PKCE verifier")
	}
	identity, err := provider.Identify(ctx, callback.Query().Get("code"), start.Verifier)
	if err != nil {
		t.Fatalf("Identify: %v", err)
	}
	if identity.Subject == "" || app.DirectoryUsername(identity.Username) != username {
		t.Fatalf("Identify = %+v, want the user %s", identity, username)
	}
}
