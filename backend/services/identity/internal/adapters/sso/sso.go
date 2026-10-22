// Package sso connects Identity to the college's single sign-on provider,
// ZITADEL (ADR-0042). OIDC signs people in: the authorization code is
// exchanged at the provider's token endpoint with the client secret, and the
// user comes from its userinfo endpoint over the same TLS connection, so no ID
// token has to be verified locally. The directory API keeps the provider's
// accounts in step with AetherCode's, by username and password hash only.
package sso

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/aethercode/aethercode/services/identity/internal/app"
)

const requestTimeout = 15 * time.Second

// Config is the provider and this client. An empty Issuer turns SSO off.
type Config struct {
	Issuer       string
	ClientID     string
	ClientSecret string
	RedirectURI  string
	// AdminTokenFile holds a personal access token of a service user that may
	// manage users in OrganizationID. Empty turns directory sync off.
	AdminTokenFile string
	OrganizationID string
	// EmailDomain addresses accounts without an email, as
	// "<username>@<EmailDomain>"; the provider requires one.
	EmailDomain string
}

// LoadConfig reads IDENTITY_SSO_*.
func LoadConfig() (Config, error) {
	get := func(key string) string { return strings.TrimSpace(os.Getenv(key)) }
	config := Config{
		Issuer: strings.TrimRight(get("IDENTITY_SSO_ISSUER"), "/"), ClientID: get("IDENTITY_SSO_CLIENT_ID"),
		ClientSecret: get("IDENTITY_SSO_CLIENT_SECRET"), RedirectURI: get("IDENTITY_SSO_REDIRECT_URI"),
		AdminTokenFile: get("IDENTITY_SSO_ADMIN_TOKEN_FILE"), OrganizationID: get("IDENTITY_SSO_ORGANIZATION_ID"),
		EmailDomain: get("IDENTITY_SSO_EMAIL_DOMAIN"),
	}
	if config.Issuer == "" {
		return config, nil
	}
	if !strings.HasPrefix(config.Issuer, "https://") && !strings.HasPrefix(config.Issuer, "http://") {
		return Config{}, fmt.Errorf("IDENTITY_SSO_ISSUER must be a URL")
	}
	if config.ClientID == "" || config.ClientSecret == "" || config.RedirectURI == "" {
		return Config{}, fmt.Errorf("SSO needs IDENTITY_SSO_CLIENT_ID, IDENTITY_SSO_CLIENT_SECRET and IDENTITY_SSO_REDIRECT_URI")
	}
	if config.AdminTokenFile != "" && (config.OrganizationID == "" || config.EmailDomain == "") {
		return Config{}, fmt.Errorf("directory sync needs IDENTITY_SSO_ORGANIZATION_ID and IDENTITY_SSO_EMAIL_DOMAIN")
	}
	return config, nil
}

// Provider talks to the SSO provider.
type Provider struct {
	config Config
	client *http.Client

	mu        sync.Mutex
	discovery *discovery
}

type discovery struct {
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	UserinfoEndpoint      string `json:"userinfo_endpoint"`
}

// New returns a provider client; nil when SSO is off.
func New(config Config) *Provider {
	if config.Issuer == "" {
		return nil
	}
	return &Provider{config: config, client: &http.Client{Timeout: requestTimeout}}
}

func (provider *Provider) endpoints(contextValue context.Context) (discovery, error) {
	provider.mu.Lock()
	defer provider.mu.Unlock()
	if provider.discovery != nil {
		return *provider.discovery, nil
	}
	var found discovery
	if err := provider.do(contextValue, http.MethodGet, provider.config.Issuer+"/.well-known/openid-configuration", nil, nil, &found); err != nil {
		return discovery{}, fmt.Errorf("read the provider's OpenID configuration: %w", err)
	}
	if found.AuthorizationEndpoint == "" || found.TokenEndpoint == "" || found.UserinfoEndpoint == "" {
		return discovery{}, fmt.Errorf("the provider's OpenID configuration lacks endpoints")
	}
	provider.discovery = &found
	return found, nil
}

// Start returns where to send the browser, with the state and PKCE verifier
// the caller keeps until the callback.
func (provider *Provider) Start(contextValue context.Context) (app.SSOStart, error) {
	endpoints, err := provider.endpoints(contextValue)
	if err != nil {
		return app.SSOStart{}, err
	}
	state, err := randomToken()
	if err != nil {
		return app.SSOStart{}, err
	}
	verifier, err := randomToken()
	if err != nil {
		return app.SSOStart{}, err
	}
	challenge := sha256.Sum256([]byte(verifier))
	query := url.Values{
		"response_type": {"code"}, "client_id": {provider.config.ClientID}, "redirect_uri": {provider.config.RedirectURI},
		"scope": {"openid profile email"}, "state": {state},
		"code_challenge": {base64.RawURLEncoding.EncodeToString(challenge[:])}, "code_challenge_method": {"S256"},
	}
	return app.SSOStart{AuthorizationURL: endpoints.AuthorizationEndpoint + "?" + query.Encode(), State: state, Verifier: verifier}, nil
}

// Identify exchanges the authorization code and returns who signed in.
func (provider *Provider) Identify(contextValue context.Context, code, verifier string) (app.SSOIdentity, error) {
	endpoints, err := provider.endpoints(contextValue)
	if err != nil {
		return app.SSOIdentity{}, err
	}
	form := url.Values{
		"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {provider.config.RedirectURI},
		"code_verifier": {verifier},
	}
	request, err := http.NewRequestWithContext(contextValue, http.MethodPost, endpoints.TokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return app.SSOIdentity{}, err
	}
	request.SetBasicAuth(url.QueryEscape(provider.config.ClientID), url.QueryEscape(provider.config.ClientSecret))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var token struct {
		AccessToken string `json:"access_token"`
	}
	if err := provider.send(request, &token); err != nil || token.AccessToken == "" {
		return app.SSOIdentity{}, fmt.Errorf("exchange the authorization code: %w", errors.Join(err, errors.New("no access token")))
	}
	var user struct {
		Subject           string `json:"sub"`
		PreferredUsername string `json:"preferred_username"`
		Name              string `json:"name"`
	}
	headers := map[string]string{"Authorization": "Bearer " + token.AccessToken}
	if err := provider.do(contextValue, http.MethodGet, endpoints.UserinfoEndpoint, headers, nil, &user); err != nil {
		return app.SSOIdentity{}, fmt.Errorf("read the signed-in user: %w", err)
	}
	if user.Subject == "" {
		return app.SSOIdentity{}, fmt.Errorf("the provider returned no subject")
	}
	return app.SSOIdentity{Subject: user.Subject, Username: user.PreferredUsername, Name: user.Name}, nil
}

// --- Directory -------------------------------------------------------------

// DirectoryEnabled reports whether accounts are copied to the provider.
func (provider *Provider) DirectoryEnabled() bool {
	return provider != nil && provider.config.AdminTokenFile != ""
}

func (provider *Provider) adminHeaders() (map[string]string, error) {
	token, err := os.ReadFile(provider.config.AdminTokenFile)
	if err != nil {
		return nil, fmt.Errorf("read the SSO admin token: %w", err)
	}
	return map[string]string{
		"Authorization":   "Bearer " + strings.TrimSpace(string(token)),
		"x-zitadel-orgid": provider.config.OrganizationID,
	}, nil
}

// FindUser returns the provider's user ID for a username, or "" when none.
func (provider *Provider) FindUser(contextValue context.Context, username string) (string, error) {
	headers, err := provider.adminHeaders()
	if err != nil {
		return "", err
	}
	body := map[string]any{
		"query": map[string]any{"limit": 2},
		"queries": []any{map[string]any{"userNameQuery": map[string]any{
			"userName": username, "method": "TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE",
		}}},
	}
	var found struct {
		Result []struct {
			UserID string `json:"userId"`
		} `json:"result"`
	}
	if err := provider.do(contextValue, http.MethodPost, provider.config.Issuer+"/v2/users", headers, body, &found); err != nil {
		return "", fmt.Errorf("search the directory: %w", err)
	}
	if len(found.Result) == 0 {
		return "", nil
	}
	return found.Result[0].UserID, nil
}

// CreateUser adds an account with AetherCode's password hash and returns its ID.
func (provider *Provider) CreateUser(contextValue context.Context, account app.DirectoryAccount) (string, error) {
	headers, err := provider.adminHeaders()
	if err != nil {
		return "", err
	}
	given, family := splitName(account.DisplayName)
	body := map[string]any{
		"username":       account.Username,
		"organization":   map[string]any{"orgId": provider.config.OrganizationID},
		"profile":        map[string]any{"givenName": given, "familyName": family, "displayName": account.DisplayName},
		"email":          map[string]any{"email": provider.email(account), "isVerified": true},
		"hashedPassword": map[string]any{"hash": account.PasswordHash, "changeRequired": account.MustChange},
	}
	var created struct {
		UserID string `json:"userId"`
	}
	if err := provider.do(contextValue, http.MethodPost, provider.config.Issuer+"/v2/users/human", headers, body, &created); err != nil {
		return "", fmt.Errorf("create the directory account: %w", err)
	}
	return created.UserID, nil
}

// UpdateUser copies the name and password hash to an account AetherCode created.
func (provider *Provider) UpdateUser(contextValue context.Context, userID string, account app.DirectoryAccount) error {
	headers, err := provider.adminHeaders()
	if err != nil {
		return err
	}
	given, family := splitName(account.DisplayName)
	body := map[string]any{
		"profile":  map[string]any{"givenName": given, "familyName": family, "displayName": account.DisplayName},
		"password": map[string]any{"hashedPassword": map[string]any{"hash": account.PasswordHash, "changeRequired": account.MustChange}},
	}
	if err := provider.do(contextValue, http.MethodPut, provider.config.Issuer+"/v2/users/human/"+url.PathEscape(userID), headers, body, nil); err != nil {
		return fmt.Errorf("update the directory account: %w", err)
	}
	return nil
}

func (provider *Provider) email(account app.DirectoryAccount) string {
	if account.Email != "" {
		return account.Email
	}
	return account.Username + "@" + provider.config.EmailDomain
}

// splitName gives the provider the given and family names it requires.
func splitName(displayName string) (string, string) {
	fields := strings.Fields(displayName)
	switch len(fields) {
	case 0:
		return "-", "-"
	case 1:
		return fields[0], "-"
	default:
		return strings.Join(fields[:len(fields)-1], " "), fields[len(fields)-1]
	}
}

// --- HTTP ------------------------------------------------------------------

func (provider *Provider) do(contextValue context.Context, method, target string, headers map[string]string, body, out any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(contextValue, method, target, reader)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	return provider.send(request, out)
}

// StatusError is a provider response outside 2xx.
type StatusError struct {
	Status int
	Body   string
}

func (err StatusError) Error() string {
	return fmt.Sprintf("provider returned %d: %s", err.Status, err.Body)
}

func (provider *Provider) send(request *http.Request, out any) error {
	response, err := provider.client.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return StatusError{Status: response.StatusCode, Body: strings.TrimSpace(string(payload[:min(len(payload), 300)]))}
	}
	if out == nil || len(payload) == 0 {
		return nil
	}
	return json.Unmarshal(payload, out)
}

func randomToken() (string, error) {
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}
