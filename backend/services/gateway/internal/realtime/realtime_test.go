package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/authn"
	"github.com/aethercode/aethercode/libs/pkg/telemetry"
	"github.com/coder/websocket"
)

const tenantA = "11111111-1111-4111-8111-111111111111"
const tenantB = "22222222-2222-4222-8222-222222222222"

func event(eventType, tenant string) []byte {
	data, _ := json.Marshal(map[string]any{
		"id": "e1", "type": eventType, "schema_version": 1, "aggregate_type": "attempt", "aggregate_id": "a1",
		"tenant_id": tenant, "occurred_at": "2026-11-01T10:00:00Z", "payload": map[string]string{"secret": "never-forwarded"},
	})
	return data
}

func TestHintForAllowlistsAndStripsPayload(t *testing.T) {
	cases := []struct {
		eventType, tenant, topic string
		ok                       bool
	}{
		{"submission.attempt_submitted.v1", tenantA, "attempts", true},
		{"submission.evaluation_requested.v1", tenantA, "grading", true},
		{"judge.completed.v1", tenantA, "grading", true},
		{"user.staff_audit_recorded.v1", tenantA, "activity", true},
		{"user.role_assigned.v1", tenantA, "", false},
		{"identity.password_reset_requested.v1", tenantA, "", false},
		{"submission.attempt_started.v1", "", "", false},
	}
	for _, test := range cases {
		hint, tenant, ok := HintFor(event(test.eventType, test.tenant))
		if ok != test.ok || hint.Topic != test.topic || (ok && tenant != test.tenant) {
			t.Fatalf("%s: got %+v %q %v", test.eventType, hint, tenant, ok)
		}
		if encoded, _ := json.Marshal(hint); strings.Contains(string(encoded), "never-forwarded") {
			t.Fatalf("%s: hint carried the payload: %s", test.eventType, encoded)
		}
	}
}

func TestHubScopesMessages(t *testing.T) {
	hub := NewHub(8)
	inA := &client{principal: "p1", tenant: tenantA, health: true, send: make(chan []byte, 4)}
	inB := &client{principal: "p2", tenant: tenantB, send: make(chan []byte, 4)}
	full := &client{principal: "p3", tenant: tenantA, send: make(chan []byte)} // never drained
	for _, entry := range []*client{inA, inB, full} {
		if !hub.add(entry) {
			t.Fatal("add refused")
		}
	}
	hub.PublishEvent(event("submission.attempt_submitted.v1", tenantA))
	hub.PublishHealth(Health{Type: "health", CheckedAt: time.Now()})
	if len(inA.send) != 2 {
		t.Fatalf("tenant A admin got %d messages, want hint and health", len(inA.send))
	}
	if len(inB.send) != 0 {
		t.Fatalf("tenant B got %d messages for tenant A's event and health it may not see", len(inB.send))
	}
}

func TestHubLimitsConnectionsPerPrincipal(t *testing.T) {
	hub := NewHub(2)
	for index := range 2 {
		if !hub.add(&client{principal: "p1", send: make(chan []byte)}) {
			t.Fatalf("connection %d refused", index)
		}
	}
	if hub.add(&client{principal: "p1", send: make(chan []byte)}) {
		t.Fatal("third connection for one principal was accepted")
	}
	if !hub.add(&client{principal: "p2", send: make(chan []byte)}) {
		t.Fatal("another principal was refused")
	}
}

func TestProberUsesConfiguredUpstreams(t *testing.T) {
	healthy := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/healthz" {
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer healthy.Close()
	failing := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) { writer.WriteHeader(http.StatusServiceUnavailable) }))
	defer failing.Close()
	prober := NewProber(map[string]*url.URL{"user": mustURL(t, healthy.URL), "analytics": mustURL(t, failing.URL)}, map[string]string{"user": "Accounts"}, healthy.Client(), time.Second)
	snapshot := prober.Probe(context.Background())
	if len(snapshot.Services) != 2 || snapshot.Services[0].Name != "analytics" || snapshot.Services[1].Name != "user" {
		t.Fatalf("services not listed by name from config: %+v", snapshot.Services)
	}
	if snapshot.Services[0].Ready || !snapshot.Services[1].Ready || snapshot.Services[1].Description != "Accounts" {
		t.Fatalf("unexpected readiness: %+v", snapshot.Services)
	}
}

type fakeVerifier map[string]authn.Claims

func (verifier fakeVerifier) Verify(token string, _ time.Time) (authn.Claims, error) {
	claims, ok := verifier[token]
	if !ok {
		return authn.Claims{}, errors.New("invalid token")
	}
	return claims, nil
}

// fixture runs the realtime server against a fake user service where each token has fixed roles.
func fixture(t *testing.T, expires time.Time) (*httptest.Server, *Hub) {
	t.Helper()
	roles := map[string]string{
		"admin":   `{"roles":[{"role_name":"college_admin","tenant_id":"` + tenantA + `"}]}`,
		"faculty": `{"roles":[{"role_name":"department_user","tenant_id":"` + tenantA + `"}]}`,
		"student": `{"roles":[{"role_name":"student","tenant_id":"` + tenantA + `"}]}`,
	}
	users := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, ok := roles[strings.TrimPrefix(request.Header.Get("Authorization"), "Bearer ")]
		if request.URL.Path != "/v1/me" || !ok {
			writer.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = writer.Write([]byte(body))
	}))
	t.Cleanup(users.Close)
	verifier := fakeVerifier{}
	for token := range roles {
		verifier[token] = authn.Claims{Subject: token, ExpiresAt: expires.Unix()}
	}
	hub := NewHub(8)
	prober := NewProber(map[string]*url.URL{"user": mustURL(t, users.URL)}, nil, users.Client(), time.Second)
	hub.PublishHealth(prober.Probe(context.Background()))
	go prober.Run(t.Context(), hub.PublishHealth)
	server, err := NewServer(Config{Verifier: verifier, Hub: hub, Prober: prober, UserService: mustURL(t, users.URL), Client: users.Client(), Origins: []string{"https://exam.example.edu"}, Cookie: "ac_access"})
	if err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(server)
	t.Cleanup(httpServer.Close)
	return httpServer, hub
}

// dial returns the connection and the handshake's status code.
func dial(t *testing.T, base, token, origin, tenant string) (*websocket.Conn, int, error) {
	t.Helper()
	header := http.Header{"Origin": {origin}}
	if token != "" {
		header.Set("Cookie", "ac_access="+token)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, response, err := websocket.Dial(ctx, strings.Replace(base, "http", "ws", 1)+"/api/realtime?tenant="+tenant, &websocket.DialOptions{HTTPHeader: header})
	status := 0
	if response != nil {
		status = response.StatusCode
		if response.Body != nil {
			_ = response.Body.Close()
		}
	}
	return conn, status, err
}

func TestSocketRefusesBadCallers(t *testing.T) {
	server, _ := fixture(t, time.Now().Add(time.Hour))
	cases := []struct {
		name, token, origin, tenant string
		status                      int
	}{
		{"other site", "faculty", "https://evil.example", tenantA, http.StatusForbidden},
		{"no session", "", "https://exam.example.edu", tenantA, http.StatusUnauthorized},
		{"bad token", "forged", "https://exam.example.edu", tenantA, http.StatusForbidden},
		{"student", "student", "https://exam.example.edu", tenantA, http.StatusForbidden},
		{"other tenant", "faculty", "https://exam.example.edu", tenantB, http.StatusForbidden},
	}
	for _, test := range cases {
		conn, status, err := dial(t, server.URL, test.token, test.origin, test.tenant)
		if err == nil {
			_ = conn.CloseNow()
			t.Fatalf("%s: connection accepted", test.name)
		}
		if status != test.status {
			t.Fatalf("%s: got %d, want %d", test.name, status, test.status)
		}
	}
}

func read(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var message map[string]any
	if err := json.Unmarshal(data, &message); err != nil {
		t.Fatal(err)
	}
	return message
}

func TestSocketDeliversScopedMessages(t *testing.T) {
	server, hub := fixture(t, time.Now().Add(time.Hour))
	admin, _, err := dial(t, server.URL, "admin", "https://exam.example.edu", tenantA)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = admin.CloseNow() }()
	if message := read(t, admin); message["type"] != "health" {
		t.Fatalf("admin's first message was %v, want health", message)
	}
	faculty, _, err := dial(t, server.URL, "faculty", "https://exam.example.edu", tenantA)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = faculty.CloseNow() }()
	waitForClients(t, hub, 2)
	hub.PublishEvent(event("identity.login.v1", tenantA))
	hub.PublishEvent(event("submission.attempt_graded.v1", tenantB))
	hub.PublishEvent(event("submission.attempt_graded.v1", tenantA))
	if message := read(t, faculty); message["type"] != "changed" || message["topic"] != "attempts" {
		t.Fatalf("faculty got %v, want only tenant A's attempt hint", message)
	}
}

func TestSocketClosesWhenTheSessionExpires(t *testing.T) {
	server, _ := fixture(t, time.Now().Add(1500*time.Millisecond))
	conn, _, err := dial(t, server.URL, "faculty", "https://exam.example.edu", tenantA)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _, err = conn.Read(ctx)
	if websocket.CloseStatus(err) != statusExpired {
		t.Fatalf("got %v, want close %d", err, statusExpired)
	}
}

func TestServicesEndpointIsForAdministrators(t *testing.T) {
	server, _ := fixture(t, time.Now().Add(time.Hour))
	get := func(token string) (int, []byte) {
		request, _ := http.NewRequest(http.MethodGet, server.URL+"/api/realtime/services?tenant="+tenantA, nil)
		if token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = response.Body.Close() }()
		body, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		return response.StatusCode, body
	}
	if status, _ := get(""); status != http.StatusUnauthorized {
		t.Fatalf("anonymous got %d", status)
	}
	if status, _ := get("faculty"); status != http.StatusForbidden {
		t.Fatalf("faculty got %d", status)
	}
	status, body := get("admin")
	var snapshot Health
	if err := json.Unmarshal(body, &snapshot); err != nil || status != http.StatusOK || len(snapshot.Services) != 1 || snapshot.Services[0].Name != "user" {
		t.Fatalf("admin got %d %+v %v", status, snapshot, err)
	}
}

func waitForClients(t *testing.T, hub *Hub, count int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		hub.mu.RLock()
		open := len(hub.clients)
		hub.mu.RUnlock()
		if open >= count {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("only %d clients connected", count)
}

func mustURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}

// The gateway serves the socket behind the telemetry middleware and an HTTP
// server with short timeouts. Both must let a WebSocket through and keep it
// alive past those timeouts (ADR-0050); the handler tests alone hit neither.
func TestSocketSurvivesTheGatewayMiddlewareAndTimeouts(t *testing.T) {
	roles := `{"roles":[{"role_name":"college_admin","tenant_id":"` + tenantA + `"}]}`
	users := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) { _, _ = writer.Write([]byte(roles)) }))
	t.Cleanup(users.Close)
	hub := NewHub(8)
	prober := NewProber(map[string]*url.URL{"user": mustURL(t, users.URL)}, nil, users.Client(), time.Second)
	go prober.Run(t.Context(), hub.PublishHealth)
	for prober.Latest().CheckedAt.IsZero() {
		time.Sleep(10 * time.Millisecond)
	}
	server, err := NewServer(Config{
		Verifier: fakeVerifier{"admin": authn.Claims{Subject: "admin", ExpiresAt: time.Now().Add(time.Hour).Unix()}},
		Hub:      hub, Prober: prober, UserService: mustURL(t, users.URL), Client: users.Client(),
		Origins: []string{"https://exam.example.edu"}, Cookie: "ac_access",
	})
	if err != nil {
		t.Fatal(err)
	}
	gateway := httptest.NewUnstartedServer(telemetry.HTTPMiddleware("gateway", server))
	gateway.Config.ReadTimeout, gateway.Config.WriteTimeout = 300*time.Millisecond, 300*time.Millisecond
	gateway.Start()
	t.Cleanup(gateway.Close)

	conn, status, err := dial(t, gateway.URL, "admin", "https://exam.example.edu", tenantA)
	if err != nil {
		t.Fatalf("upgrade through the middleware failed with %d: %v", status, err)
	}
	defer func() { _ = conn.CloseNow() }()
	if status != http.StatusSwitchingProtocols {
		t.Fatalf("status = %d, want 101", status)
	}
	if message := read(t, conn); message["type"] != "health" {
		t.Fatalf("first message = %v, want health", message)
	}
	waitForClients(t, hub, 1)
	time.Sleep(700 * time.Millisecond) // well past both timeouts
	hub.PublishEvent(event("submission.attempt_graded.v1", tenantA))
	if message := read(t, conn); message["type"] != "changed" || message["topic"] != "attempts" {
		t.Fatalf("connection did not survive the server timeouts: got %v", message)
	}
}
