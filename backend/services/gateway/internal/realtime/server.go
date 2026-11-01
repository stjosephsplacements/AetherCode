package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/authn"
	"github.com/coder/websocket"
)

const (
	pingInterval = 25 * time.Second
	writeTimeout = 10 * time.Second
	sendBuffer   = 32
	// statusExpired asks the browser to reconnect with its refreshed session.
	statusExpired websocket.StatusCode = 4401
)

// Verifier is the gateway's access-token verifier.
type Verifier interface {
	Verify(token string, now time.Time) (authn.Claims, error)
}

type Config struct {
	Verifier Verifier
	Hub      *Hub
	Prober   *Prober
	// UserService is the user upstream, asked who the caller is on connect.
	UserService *url.URL
	Client      *http.Client
	// Origins are the exact browser origins allowed to open a socket. Empty disables the socket.
	Origins []string
	Cookie  string
	Now     func() time.Time
}

// Server handles GET /api/realtime (WebSocket) and GET /api/realtime/services.
type Server struct {
	config  Config
	origins map[string]struct{}
	hosts   []string
}

func NewServer(config Config) (*Server, error) {
	if config.Verifier == nil || config.Hub == nil || config.Prober == nil || config.UserService == nil || config.Client == nil {
		return nil, errors.New("realtime server requires a verifier, hub, prober, user service and client")
	}
	if config.Cookie == "" {
		return nil, errors.New("realtime server requires the session cookie name")
	}
	if config.Now == nil {
		config.Now = time.Now
	}
	server := &Server{config: config, origins: make(map[string]struct{}, len(config.Origins))}
	for _, origin := range config.Origins {
		parsed, err := url.Parse(origin)
		if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" || parsed.Path != "" {
			return nil, fmt.Errorf("invalid realtime origin %q", origin)
		}
		server.origins[origin] = struct{}{}
		server.hosts = append(server.hosts, parsed.Host)
	}
	return server, nil
}

func (server *Server) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	switch request.URL.Path {
	case "/api/realtime":
		server.serveSocket(writer, request)
	case "/api/realtime/services":
		server.serveServices(writer, request)
	default:
		writeError(writer, http.StatusNotFound, "not found")
	}
}

// scope is what one caller may receive in one tenant.
type scope struct {
	principal string
	tenant    string
	health    bool
	expires   time.Time
}

type me struct {
	Roles []struct {
		RoleName string `json:"role_name"`
		TenantID string `json:"tenant_id"`
	} `json:"roles"`
}

var errForbidden = errors.New("forbidden")

// authorize verifies the token, then asks the user service for the caller's roles.
// Only staff connect; health is for college and platform administrators.
func (server *Server) authorize(ctx context.Context, token, tenant string) (scope, error) {
	claims, err := server.config.Verifier.Verify(token, server.config.Now().UTC())
	if err != nil {
		return scope{}, err
	}
	if tenant == "" {
		return scope{}, errForbidden
	}
	target := *server.config.UserService
	target.Path = strings.TrimRight(target.Path, "/") + "/v1/me"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return scope{}, err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Accept", "application/json")
	response, err := server.config.Client.Do(request)
	if err != nil {
		return scope{}, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return scope{}, fmt.Errorf("user service returned %d: %w", response.StatusCode, errForbidden)
	}
	var caller me
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&caller); err != nil {
		return scope{}, err
	}
	result := scope{principal: claims.Subject, tenant: tenant, expires: time.Unix(claims.ExpiresAt, 0)}
	staff := false
	for _, role := range caller.Roles {
		switch {
		case role.RoleName == "super_admin":
			staff, result.health = true, true
		case role.RoleName == "student" || role.TenantID != tenant:
		case role.RoleName == "college_admin":
			staff, result.health = true, true
		default:
			staff = true
		}
	}
	if !staff {
		return scope{}, errForbidden
	}
	return result, nil
}

func (server *Server) serveSocket(writer http.ResponseWriter, request *http.Request) {
	if len(server.origins) == 0 {
		writeError(writer, http.StatusNotFound, "realtime is not enabled")
		return
	}
	// Browsers always send Origin on a WebSocket; another site's page must not ride the session cookie.
	if _, allowed := server.origins[request.Header.Get("Origin")]; !allowed {
		writeError(writer, http.StatusForbidden, "origin not allowed")
		return
	}
	cookie, err := request.Cookie(server.config.Cookie)
	if err != nil || cookie.Value == "" {
		writeError(writer, http.StatusUnauthorized, "a session is required")
		return
	}
	access, err := server.authorize(request.Context(), cookie.Value, request.URL.Query().Get("tenant"))
	if err != nil {
		writeError(writer, http.StatusForbidden, "not allowed")
		return
	}
	entry := &client{principal: access.principal, tenant: access.tenant, health: access.health, send: make(chan []byte, sendBuffer)}
	if !server.config.Hub.add(entry) {
		writeError(writer, http.StatusTooManyRequests, "too many open connections")
		return
	}
	defer server.config.Hub.remove(entry)

	conn, err := websocket.Accept(writer, request, &websocket.AcceptOptions{OriginPatterns: server.hosts})
	if err != nil {
		return
	}
	defer func() { _ = conn.CloseNow() }()

	// The browser sends nothing; reading only notices it leaving.
	ctx := conn.CloseRead(request.Context())
	expiry := time.NewTimer(time.Until(access.expires))
	defer expiry.Stop()

	if entry.health {
		if snapshot := server.config.Prober.Latest(); !snapshot.CheckedAt.IsZero() {
			if message, err := json.Marshal(snapshot); err == nil {
				entry.send <- message
			}
		}
	}

	ping := time.NewTicker(pingInterval)
	defer ping.Stop()
	for {
		select {
		case message := <-entry.send:
			if err := write(ctx, conn, message); err != nil {
				return
			}
		case <-ping.C:
			pingCtx, cancelPing := context.WithTimeout(ctx, writeTimeout)
			err := conn.Ping(pingCtx)
			cancelPing()
			if err != nil {
				return
			}
		case <-expiry.C:
			_ = conn.Close(statusExpired, "session expired")
			return
		case <-ctx.Done():
			return
		}
	}
}

func write(ctx context.Context, conn *websocket.Conn, message []byte) error {
	ctx, cancel := context.WithTimeout(ctx, writeTimeout)
	defer cancel()
	return conn.Write(ctx, websocket.MessageText, message)
}

// serveServices is the same snapshot over HTTP for a page's first render, behind the bearer token.
func (server *Server) serveServices(writer http.ResponseWriter, request *http.Request) {
	token, found := strings.CutPrefix(request.Header.Get("Authorization"), "Bearer ")
	if !found || token == "" {
		writeError(writer, http.StatusUnauthorized, "a valid bearer assertion is required")
		return
	}
	access, err := server.authorize(request.Context(), token, request.URL.Query().Get("tenant"))
	if err != nil || !access.health {
		writeError(writer, http.StatusForbidden, "not allowed")
		return
	}
	snapshot := server.config.Prober.Latest()
	if snapshot.CheckedAt.IsZero() {
		snapshot = server.config.Prober.Probe(request.Context())
	}
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(writer).Encode(snapshot)
}

func writeError(writer http.ResponseWriter, status int, message string) {
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(map[string]string{"error": message})
}
