// Package mail sends the platform's transactional email through Microsoft Graph (Exchange Online) with an Entra
// application's client credentials. It is off unless IDENTITY_MAIL_* is configured.
package mail

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/mail"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

var tenantPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// Config is read from IDENTITY_MAIL_TENANT_ID, IDENTITY_MAIL_CLIENT_ID, IDENTITY_MAIL_CLIENT_SECRET,
// IDENTITY_MAIL_SENDER and IDENTITY_PUBLIC_BASE_URL. The four IDENTITY_MAIL_* values are set together or not at all.
type Config struct {
	TenantID, ClientID, ClientSecret, Sender, PublicBaseURL string
}

// LoadConfig returns the zero Config when mail is not configured, and an error for a partial or malformed one.
func LoadConfig() (Config, error) {
	config := Config{
		TenantID:      strings.TrimSpace(os.Getenv("IDENTITY_MAIL_TENANT_ID")),
		ClientID:      strings.TrimSpace(os.Getenv("IDENTITY_MAIL_CLIENT_ID")),
		ClientSecret:  strings.TrimSpace(os.Getenv("IDENTITY_MAIL_CLIENT_SECRET")),
		Sender:        strings.TrimSpace(os.Getenv("IDENTITY_MAIL_SENDER")),
		PublicBaseURL: strings.TrimSuffix(strings.TrimSpace(os.Getenv("IDENTITY_PUBLIC_BASE_URL")), "/"),
	}
	// The public origin alone does not turn mail on: the chart always sets it.
	if config.TenantID == "" && config.ClientID == "" && config.ClientSecret == "" && config.Sender == "" {
		return Config{}, nil
	}
	if config.TenantID == "" || config.ClientID == "" || config.ClientSecret == "" || config.Sender == "" || config.PublicBaseURL == "" {
		return Config{}, errors.New("IDENTITY_MAIL_TENANT_ID, _CLIENT_ID, _CLIENT_SECRET, _SENDER and IDENTITY_PUBLIC_BASE_URL must all be set, or none")
	}
	if !tenantPattern.MatchString(config.TenantID) {
		return Config{}, errors.New("IDENTITY_MAIL_TENANT_ID must be a GUID")
	}
	if address, err := mail.ParseAddress(config.Sender); err != nil || address.Address != config.Sender {
		return Config{}, errors.New("IDENTITY_MAIL_SENDER must be a plain email address")
	}
	base, err := url.Parse(config.PublicBaseURL)
	if err != nil || (base.Scheme != "https" && base.Scheme != "http") || base.Host == "" || base.Path != "" || base.RawQuery != "" || base.Fragment != "" {
		return Config{}, errors.New("IDENTITY_PUBLIC_BASE_URL must be the web app's origin, such as https://exam.example.edu")
	}
	return config, nil
}

// Graph is a Microsoft Graph mail sender. It is safe for concurrent use.
type Graph struct {
	config  Config
	client  *http.Client
	authURL string // token endpoint
	sendURL string // sendMail endpoint
	now     func() time.Time

	mu      sync.Mutex
	token   string
	expires time.Time
}

// New returns nil when mail is not configured.
func New(config Config) *Graph {
	if config == (Config{}) {
		return nil
	}
	return &Graph{
		config:  config,
		client:  &http.Client{Timeout: 20 * time.Second},
		authURL: "https://login.microsoftonline.com/" + config.TenantID + "/oauth2/v2.0/token",
		sendURL: "https://graph.microsoft.com/v1.0/users/" + url.PathEscape(config.Sender) + "/sendMail",
		now:     time.Now,
	}
}

func (graph *Graph) accessToken(ctx context.Context, force bool) (string, error) {
	graph.mu.Lock()
	defer graph.mu.Unlock()
	if !force && graph.token != "" && graph.now().Before(graph.expires) {
		return graph.token, nil
	}
	form := url.Values{
		"client_id": {graph.config.ClientID}, "client_secret": {graph.config.ClientSecret},
		"scope": {"https://graph.microsoft.com/.default"}, "grant_type": {"client_credentials"},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, graph.authURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("build token request: %w", err)
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := graph.client.Do(request)
	if err != nil {
		return "", fmt.Errorf("request mail access token: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	var body struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
		Error       string `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&body); err != nil || response.StatusCode != http.StatusOK || body.AccessToken == "" {
		return "", fmt.Errorf("mail access token refused: HTTP %d %s", response.StatusCode, body.Error)
	}
	graph.token = body.AccessToken
	graph.expires = graph.now().Add(time.Duration(body.ExpiresIn)*time.Second - time.Minute)
	return graph.token, nil
}

// SendPasswordReset emails a sign-in-free link that completes a password reset. token is the opaque reset bearer.
func (graph *Graph) SendPasswordReset(ctx context.Context, to, token string, validFor time.Duration) error {
	if address, err := mail.ParseAddress(to); err != nil || address.Address != to {
		return errors.New("recipient is not a plain email address")
	}
	link := graph.config.PublicBaseURL + "/auth/reset-password?token=" + url.QueryEscape(token)
	body := passwordResetBody(link, validFor)
	payload, err := json.Marshal(map[string]any{
		"message": map[string]any{
			"subject":      "Reset your AetherCode password",
			"body":         map[string]string{"contentType": "HTML", "content": body},
			"toRecipients": []map[string]any{{"emailAddress": map[string]string{"address": to}}},
		},
		"saveToSentItems": false,
	})
	if err != nil {
		return fmt.Errorf("encode mail: %w", err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		accessToken, err := graph.accessToken(ctx, attempt > 0)
		if err != nil {
			return err
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, graph.sendURL, bytes.NewReader(payload))
		if err != nil {
			return fmt.Errorf("build sendMail request: %w", err)
		}
		request.Header.Set("Authorization", "Bearer "+accessToken)
		request.Header.Set("Content-Type", "application/json")
		response, err := graph.client.Do(request)
		if err != nil {
			return fmt.Errorf("send mail: %w", err)
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1<<20))
		_ = response.Body.Close()
		switch {
		case response.StatusCode == http.StatusAccepted:
			return nil
		case response.StatusCode == http.StatusUnauthorized && attempt == 0: // a revoked or expired cached token: fetch another
			continue
		default:
			return fmt.Errorf("Microsoft Graph refused the message: HTTP %d", response.StatusCode)
		}
	}
	return errors.New("Microsoft Graph refused the message")
}

func passwordResetBody(link string, validFor time.Duration) string {
	minutes := int(validFor.Round(time.Minute) / time.Minute)
	escaped := html.EscapeString(link)
	return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1b1b2f">` +
		`<h1 style="font-size:20px;margin:0 0 16px">Reset your AetherCode password</h1>` +
		`<p style="line-height:1.5">Someone asked to reset the password for this account. If that was you, choose a new password with the button below. ` +
		fmt.Sprintf(`The link works once and expires in %d minutes.</p>`, minutes) +
		`<p style="margin:24px 0"><a href="` + escaped + `" style="background:#b73c07;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;display:inline-block">Choose a new password</a></p>` +
		`<p style="line-height:1.5;color:#555;font-size:13px">If the button does not open, paste this address into your browser:<br>` + escaped + `</p>` +
		`<p style="line-height:1.5;color:#555;font-size:13px">If you did not ask for this, ignore this email; your password has not changed.</p></div>`
}
