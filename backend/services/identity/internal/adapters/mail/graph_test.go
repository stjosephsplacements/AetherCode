package mail

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func testGraph(t *testing.T, handler http.HandlerFunc) *Graph {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	graph := New(Config{TenantID: "11111111-2222-3333-4444-555555555555", ClientID: "client", ClientSecret: "secret", Sender: "no-reply@college.edu", PublicBaseURL: "https://exam.college.edu"})
	graph.authURL, graph.sendURL = server.URL+"/token", server.URL+"/send"
	return graph
}

func TestSendPasswordResetPostsTheLinkAndReusesTheToken(t *testing.T) {
	var tokens atomic.Int32
	var sent string
	graph := testGraph(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			tokens.Add(1)
			_ = r.ParseForm()
			if r.Form.Get("grant_type") != "client_credentials" || r.Form.Get("scope") != "https://graph.microsoft.com/.default" {
				t.Errorf("unexpected token form %v", r.Form)
			}
			_, _ = io.WriteString(w, `{"access_token":"abc","expires_in":3600}`)
		case "/send":
			if r.Header.Get("Authorization") != "Bearer abc" {
				t.Errorf("authorization = %q", r.Header.Get("Authorization"))
			}
			raw, _ := io.ReadAll(r.Body)
			sent = string(raw)
			w.WriteHeader(http.StatusAccepted)
		}
	})
	for range 2 {
		if err := graph.SendPasswordReset(context.Background(), "asha@college.edu", "tok+/=", 30*time.Minute); err != nil {
			t.Fatal(err)
		}
	}
	if tokens.Load() != 1 {
		t.Errorf("fetched %d access tokens for two mails, want 1", tokens.Load())
	}
	for _, want := range []string{"asha@college.edu", "https://exam.college.edu/auth/reset-password?token=tok%2B%2F%3D", "30 minutes", "Reset your AetherCode password"} {
		if !strings.Contains(sent, want) {
			t.Errorf("message lacks %q: %s", want, sent)
		}
	}
}

func TestSendPasswordResetRefreshesARevokedToken(t *testing.T) {
	var tokens atomic.Int32
	graph := testGraph(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/token" {
			n := tokens.Add(1)
			_, _ = io.WriteString(w, map[int32]string{1: `{"access_token":"old","expires_in":3600}`, 2: `{"access_token":"new","expires_in":3600}`}[n])
			return
		}
		if r.Header.Get("Authorization") == "Bearer old" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	})
	if err := graph.SendPasswordReset(context.Background(), "asha@college.edu", "t", time.Hour); err != nil {
		t.Fatal(err)
	}
	if tokens.Load() != 2 {
		t.Errorf("fetched %d tokens, want a second after the 401", tokens.Load())
	}
}

func TestSendPasswordResetReportsRefusalsWithoutTheSecret(t *testing.T) {
	graph := testGraph(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/token" {
			_, _ = io.WriteString(w, `{"access_token":"abc","expires_in":3600}`)
			return
		}
		w.WriteHeader(http.StatusForbidden)
	})
	err := graph.SendPasswordReset(context.Background(), "asha@college.edu", "t", time.Hour)
	if err == nil || !strings.Contains(err.Error(), "403") || strings.Contains(err.Error(), "secret") {
		t.Fatalf("error = %v", err)
	}
	if err := graph.SendPasswordReset(context.Background(), "not an address", "t", time.Hour); err == nil {
		t.Fatal("a malformed recipient was accepted")
	}
}

func TestLoadConfigRequiresAllOrNone(t *testing.T) {
	for _, name := range []string{"IDENTITY_MAIL_TENANT_ID", "IDENTITY_MAIL_CLIENT_ID", "IDENTITY_MAIL_CLIENT_SECRET", "IDENTITY_MAIL_SENDER", "IDENTITY_PUBLIC_BASE_URL"} {
		t.Setenv(name, "")
	}
	if config, err := LoadConfig(); err != nil || config != (Config{}) {
		t.Fatalf("unset = %v, %v; want zero config and no error", config, err)
	}
	t.Setenv("IDENTITY_PUBLIC_BASE_URL", "https://exam.college.edu")
	if config, err := LoadConfig(); err != nil || config != (Config{}) {
		t.Fatalf("only the public origin = %v, %v; want mail off", config, err)
	}
	t.Setenv("IDENTITY_MAIL_CLIENT_ID", "client")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("a partial configuration was accepted")
	}
	t.Setenv("IDENTITY_MAIL_TENANT_ID", "../evil")
	t.Setenv("IDENTITY_MAIL_CLIENT_SECRET", "s")
	t.Setenv("IDENTITY_MAIL_SENDER", "no-reply@college.edu")
	t.Setenv("IDENTITY_PUBLIC_BASE_URL", "https://exam.college.edu")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("a tenant id that is not a GUID was accepted")
	}
	t.Setenv("IDENTITY_MAIL_TENANT_ID", "11111111-2222-3333-4444-555555555555")
	config, err := LoadConfig()
	if err != nil || config.Sender != "no-reply@college.edu" {
		t.Fatalf("valid config = %v, %v", config, err)
	}
}
