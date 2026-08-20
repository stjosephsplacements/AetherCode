// Package edge implements AetherCode's stateless public HTTP edge. It is not
// a service-discovery proxy: every reachable destination is fixed at startup.
package edge

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/authn"
)

const (
	maxSEBHeaderBytes      = 1024
	maxSEBResponseBytes    = 64 << 10
	secureConfigHeader     = "X-SafeExamBrowser-ConfigKeyHash"
	secureBrowserHeader    = "X-SafeExamBrowser-RequestHash"
	secureTenantHeader     = "X-AetherCode-SEB-Tenant-ID"
	secureSessionHeader    = "X-AetherCode-SEB-Session-ID"
	defaultSEBValidatePath = "/v1/tenants/%s/sessions/%s/validate"
)

var publicIdentityRoutes = map[string]struct{}{
	http.MethodPost + " /v1/auth/register":                {},
	http.MethodPost + " /v1/auth/verify-email":            {},
	http.MethodPost + " /v1/auth/login":                   {},
	http.MethodPost + " /v1/auth/mfa/verify-login":        {},
	http.MethodPost + " /v1/auth/refresh":                 {},
	http.MethodPost + " /v1/auth/logout":                  {},
	http.MethodPost + " /v1/auth/password-reset":          {},
	http.MethodPost + " /v1/auth/password-reset/complete": {},
}

var publicServices = map[string]struct{}{
	"identity":      {},
	"tenant":        {},
	"user":          {},
	"question-bank": {},
	"assessment":    {},
	"submission":    {},
	"seb":           {},
	"notification":  {},
	"analytics":     {},
}

var hopByHopHeaders = map[string]struct{}{
	"connection":          {},
	"keep-alive":          {},
	"proxy-authenticate":  {},
	"proxy-authorization": {},
	"proxy-connection":    {},
	"te":                  {},
	"trailer":             {},
	"transfer-encoding":   {},
	"upgrade":             {},
}

// AssertionVerifier is intentionally minimal so the handler can be tested
// without weakening the production verifier's exact JWS checks.
type AssertionVerifier interface {
	Verify(token string, now time.Time) (authn.Claims, error)
}

// Config is constructed from the validated gateway runtime configuration.
type Config struct {
	Upstreams            map[string]*url.URL
	Verifier             AssertionVerifier
	Limiter              *Limiter
	TrustedProxyCIDRs    []*net.IPNet
	SEBProtectedPrefixes []string
	Client               *http.Client
	RequestTimeout       time.Duration
	SEBValidationTimeout time.Duration
	Now                  func() time.Time
}

// Handler proxies only fixed platform service URLs. It holds no positive
// authentication or authorization cache.
type Handler struct {
	upstreams            map[string]*url.URL
	verifier             AssertionVerifier
	limiter              *Limiter
	trustedProxyCIDRs    []*net.IPNet
	sebProtectedPrefixes []string
	client               *http.Client
	sebValidationTimeout time.Duration
	now                  func() time.Time
}

type route struct {
	service       string
	forwardedPath string
	externalPath  string
	upstream      *url.URL
}

func New(config Config) (*Handler, error) {
	if config.Verifier == nil {
		return nil, fmt.Errorf("gateway assertion verifier is required")
	}
	if config.Limiter == nil {
		return nil, fmt.Errorf("gateway limiter is required")
	}
	if len(config.Upstreams) == 0 {
		return nil, fmt.Errorf("gateway requires at least one upstream")
	}
	upstreams := make(map[string]*url.URL, len(config.Upstreams))
	for service, upstream := range config.Upstreams {
		if _, allowed := publicServices[service]; !allowed || upstream == nil || !upstream.IsAbs() || upstream.Host == "" {
			return nil, fmt.Errorf("invalid gateway upstream %q", service)
		}
		copy := *upstream
		upstreams[service] = &copy
	}
	if len(config.SEBProtectedPrefixes) > 0 && upstreams["seb"] == nil {
		return nil, fmt.Errorf("SEB-protected routes require the seb upstream")
	}
	for _, prefix := range config.SEBProtectedPrefixes {
		if !validSEBPrefix(prefix) {
			return nil, fmt.Errorf("invalid SEB-protected prefix %q", prefix)
		}
	}
	if config.RequestTimeout <= 0 || config.SEBValidationTimeout <= 0 {
		return nil, fmt.Errorf("gateway request timeouts must be positive")
	}
	client := config.Client
	if client == nil {
		client = secureHTTPClient(config.RequestTimeout)
	}
	now := config.Now
	if now == nil {
		now = time.Now
	}
	return &Handler{
		upstreams:            upstreams,
		verifier:             config.Verifier,
		limiter:              config.Limiter,
		trustedProxyCIDRs:    append([]*net.IPNet(nil), config.TrustedProxyCIDRs...),
		sebProtectedPrefixes: append([]string(nil), config.SEBProtectedPrefixes...),
		client:               client,
		sebValidationTimeout: config.SEBValidationTimeout,
		now:                  now,
	}, nil
}

func secureHTTPClient(timeout time.Duration) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	// Platform service URLs must be explicit. An environment proxy could turn a
	// redirect or an outage into an unintended external network path.
	transport.Proxy = nil
	return &http.Client{
		Transport: transport,
		Timeout:   timeout,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

// ServeHTTP applies header trust rules, verifies every protected request, then
// optionally enforces SEB before opening the fixed upstream connection.
func (handler *Handler) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	route, err := handler.route(request)
	if err != nil {
		writeError(writer, http.StatusNotFound, "route is not available")
		return
	}
	if err := rejectUnsafeInboundHeaders(request); err != nil {
		writeError(writer, http.StatusBadRequest, "request contains disallowed proxy headers")
		return
	}
	clientIP, err := handler.clientIP(request)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "request has an invalid client address")
		return
	}

	public := route.service == "identity" && isPublicIdentityRoute(request.Method, route.forwardedPath)
	assertion := ""
	principalID := ""
	if !public {
		assertion, err = bearerAssertion(request)
		if err != nil {
			writeError(writer, http.StatusUnauthorized, "a valid bearer assertion is required")
			return
		}
		claims, verifyErr := handler.verifier.Verify(assertion, handler.now().UTC())
		if verifyErr != nil {
			writeError(writer, http.StatusUnauthorized, "a valid bearer assertion is required")
			return
		}
		principalID = claims.Subject
		if principalID == "" {
			writeError(writer, http.StatusUnauthorized, "a valid bearer assertion is required")
			return
		}
	}

	limitKey := "ip:" + clientIP
	if principalID != "" {
		limitKey = "principal:" + principalID
	}
	if !handler.limiter.Allow(limitKey, handler.now()) {
		writer.Header().Set("Retry-After", "1")
		writeError(writer, http.StatusTooManyRequests, "rate limit exceeded")
		return
	}

	if handler.requiresSEB(route.externalPath) {
		if err := handler.enforceSEB(request, assertion); err != nil {
			writeError(writer, http.StatusForbidden, "secure exam browser validation failed")
			return
		}
	}

	handler.forward(writer, request, route, clientIP)
}

// Ready verifies that every configured dependency is reachable through its
// operational health endpoint. A healthy process with an unreachable service
// is deliberately not ready for traffic.
func (handler *Handler) Ready(contextValue context.Context) error {
	for service, upstream := range handler.upstreams {
		target := joinURL(upstream, "/healthz")
		request, err := http.NewRequestWithContext(contextValue, http.MethodGet, target.String(), nil)
		if err != nil {
			return fmt.Errorf("build %s readiness request: %w", service, err)
		}
		response, err := handler.client.Do(request)
		if err != nil {
			return fmt.Errorf("probe %s upstream: %w", service, err)
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		_ = response.Body.Close()
		if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
			return fmt.Errorf("%s upstream readiness returned %d", service, response.StatusCode)
		}
	}
	return nil
}

func (handler *Handler) route(request *http.Request) (route, error) {
	if request == nil || request.URL == nil || request.URL.RawPath != "" || strings.Contains(request.URL.Path, "//") || strings.Contains(request.URL.Path, "..") {
		return route{}, errors.New("malformed route")
	}
	pathValue := request.URL.Path
	if !strings.HasPrefix(pathValue, "/api/") {
		return route{}, errors.New("outside API")
	}
	remainder := strings.TrimPrefix(pathValue, "/api/")
	parts := strings.SplitN(remainder, "/", 2)
	if len(parts) == 0 || parts[0] == "" {
		return route{}, errors.New("missing service")
	}
	if _, allowed := publicServices[parts[0]]; !allowed {
		return route{}, errors.New("service not allowlisted")
	}
	upstream, configured := handler.upstreams[parts[0]]
	if !configured {
		return route{}, errors.New("service not configured")
	}
	forwarded := "/"
	if len(parts) == 2 {
		forwarded += parts[1]
	}
	return route{service: parts[0], forwardedPath: forwarded, externalPath: pathValue, upstream: upstream}, nil
}

func isPublicIdentityRoute(method, forwardedPath string) bool {
	_, found := publicIdentityRoutes[method+" "+forwardedPath]
	return found
}

func (handler *Handler) requiresSEB(requestPath string) bool {
	for _, prefix := range handler.sebProtectedPrefixes {
		if requestPath == prefix || strings.HasPrefix(requestPath, prefix+"/") {
			return true
		}
	}
	return false
}

func validSEBPrefix(prefix string) bool {
	if !strings.HasPrefix(prefix, "/api/") || strings.HasSuffix(prefix, "/") || strings.Contains(prefix, "%") || strings.Contains(prefix, "//") || strings.Contains(prefix, "..") {
		return false
	}
	parts := strings.Split(strings.TrimPrefix(prefix, "/api/"), "/")
	if len(parts) == 0 {
		return false
	}
	_, allowed := publicServices[parts[0]]
	return allowed
}

func bearerAssertion(request *http.Request) (string, error) {
	values := request.Header.Values("Authorization")
	if len(values) != 1 {
		return "", errors.New("expected exactly one authorization header")
	}
	parts := strings.Fields(values[0])
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return "", errors.New("invalid bearer authorization")
	}
	return parts[1], nil
}

func rejectUnsafeInboundHeaders(request *http.Request) error {
	for name := range request.Header {
		lower := strings.ToLower(name)
		if _, hopByHop := hopByHopHeaders[lower]; hopByHop {
			return fmt.Errorf("hop-by-hop header %q", name)
		}
		switch lower {
		case "forwarded", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port", "x-real-ip", "x-original-url", "x-rewrite-url", "x-accel-redirect", "x-aethercode-principal-id", "x-aethercode-actor-id", "x-aethercode-tenant-id", "x-aethercode-user-id", "x-aethercode-service", "x-aethercode-verified-principal-id":
			return fmt.Errorf("spoofable header %q", name)
		}
		if strings.HasPrefix(lower, "x-aethercode-authz-") || strings.HasPrefix(lower, "x-aethercode-internal-") {
			return fmt.Errorf("spoofable internal header %q", name)
		}
	}
	return nil
}

func (handler *Handler) clientIP(request *http.Request) (string, error) {
	peer, err := parseIPFromRemoteAddr(request.RemoteAddr)
	if err != nil {
		return "", err
	}
	forwarded := request.Header.Values("X-Forwarded-For")
	if len(forwarded) == 0 {
		return peer.String(), nil
	}
	if len(forwarded) != 1 || !handler.isTrustedProxy(peer) {
		return "", errors.New("untrusted forwarded-for header")
	}
	parts := strings.Split(forwarded[0], ",")
	if len(parts) == 0 || len(parts) > 16 {
		return "", errors.New("invalid forwarded-for chain")
	}
	client := net.ParseIP(strings.TrimSpace(parts[0]))
	if client == nil {
		return "", errors.New("invalid forwarded-for source")
	}
	for _, part := range parts {
		if net.ParseIP(strings.TrimSpace(part)) == nil {
			return "", errors.New("invalid forwarded-for chain")
		}
	}
	return client.String(), nil
}

func parseIPFromRemoteAddr(remoteAddress string) (net.IP, error) {
	host, _, err := net.SplitHostPort(remoteAddress)
	if err != nil {
		host = remoteAddress
	}
	parsed := net.ParseIP(strings.TrimSpace(host))
	if parsed == nil {
		return nil, errors.New("invalid remote address")
	}
	return parsed, nil
}

func (handler *Handler) isTrustedProxy(peer net.IP) bool {
	for _, cidr := range handler.trustedProxyCIDRs {
		if cidr.Contains(peer) {
			return true
		}
	}
	return false
}

func (handler *Handler) enforceSEB(request *http.Request, assertion string) error {
	tenantID, sessionID, configValue, browserValue, err := secureExamHeaders(request)
	if err != nil {
		return err
	}
	fingerprint := requestFingerprint(request)
	configResult, err := handler.validateSEBSession(request.Context(), assertion, tenantID, sessionID, "config_key", &configValue, fingerprint)
	if err != nil || configResult != "matched" {
		return errors.New("config header did not validate")
	}
	browserResult, err := handler.validateSEBSession(request.Context(), assertion, tenantID, sessionID, "browser_exam_key", browserValue, fingerprint)
	if err != nil || (browserResult != "matched" && browserResult != "not_required") {
		return errors.New("browser header did not validate")
	}
	return nil
}

func secureExamHeaders(request *http.Request) (tenantID, sessionID, configValue string, browserValue *string, err error) {
	tenantID, err = requiredUUIDHeader(request, secureTenantHeader)
	if err != nil {
		return "", "", "", nil, err
	}
	sessionID, err = requiredUUIDHeader(request, secureSessionHeader)
	if err != nil {
		return "", "", "", nil, err
	}
	configValue, err = requiredBoundedHeader(request, secureConfigHeader)
	if err != nil {
		return "", "", "", nil, err
	}
	values := request.Header.Values(secureBrowserHeader)
	if len(values) == 0 {
		return tenantID, sessionID, configValue, nil, nil
	}
	if len(values) != 1 || strings.TrimSpace(values[0]) == "" || len(values[0]) > maxSEBHeaderBytes {
		return "", "", "", nil, errors.New("invalid browser exam header")
	}
	value := values[0]
	return tenantID, sessionID, configValue, &value, nil
}

func requiredBoundedHeader(request *http.Request, name string) (string, error) {
	values := request.Header.Values(name)
	if len(values) != 1 || strings.TrimSpace(values[0]) == "" || len(values[0]) > maxSEBHeaderBytes {
		return "", fmt.Errorf("invalid %s", name)
	}
	return values[0], nil
}

func requiredUUIDHeader(request *http.Request, name string) (string, error) {
	value, err := requiredBoundedHeader(request, name)
	if err != nil {
		return "", err
	}
	if !isUUID(value) {
		return "", fmt.Errorf("invalid %s", name)
	}
	return value, nil
}

func isUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, character := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			if character != '-' {
				return false
			}
			continue
		}
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f') || (character >= 'A' && character <= 'F')) {
			return false
		}
	}
	return true
}

func requestFingerprint(request *http.Request) string {
	// Never include bearer assertions, cookies, source code, or arbitrary
	// request headers. The opaque digest is enough to correlate the two
	// validation events for one gateway request without turning validation into
	// a PII or answer-content transport.
	value := strings.Join([]string{
		request.Method,
		request.URL.EscapedPath(),
		request.URL.RawQuery,
		request.Header.Get("Content-Type"),
		fmt.Sprintf("%d", request.ContentLength),
	}, "\n")
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

type sebValidationRequest struct {
	HeaderKind             string  `json:"header_kind"`
	HeaderValue            *string `json:"header_value"`
	RequestFingerprintHash string  `json:"request_fingerprint_hash"`
}

type sebValidationResponse struct {
	ValidationResult string `json:"validation_result"`
}

func (handler *Handler) validateSEBSession(parentContext context.Context, assertion, tenantID, sessionID, headerKind string, value *string, fingerprint string) (string, error) {
	payload, err := json.Marshal(sebValidationRequest{HeaderKind: headerKind, HeaderValue: value, RequestFingerprintHash: fingerprint})
	if err != nil {
		return "", fmt.Errorf("marshal SEB validation request: %w", err)
	}
	contextValue, cancel := context.WithTimeout(parentContext, handler.sebValidationTimeout)
	defer cancel()
	target := joinURL(handler.upstreams["seb"], fmt.Sprintf(defaultSEBValidatePath, tenantID, sessionID))
	request, err := http.NewRequestWithContext(contextValue, http.MethodPost, target.String(), strings.NewReader(string(payload)))
	if err != nil {
		return "", fmt.Errorf("create SEB validation request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+assertion)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := handler.client.Do(request)
	if err != nil {
		return "", fmt.Errorf("call SEB validation: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, maxSEBResponseBytes))
		return "", fmt.Errorf("SEB validation returned %d", response.StatusCode)
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, maxSEBResponseBytes))
	var result sebValidationResponse
	if err := decoder.Decode(&result); err != nil || result.ValidationResult == "" {
		return "", errors.New("SEB validation returned an invalid response")
	}
	return result.ValidationResult, nil
}

func (handler *Handler) forward(writer http.ResponseWriter, request *http.Request, route route, clientIP string) {
	target := joinURL(route.upstream, route.forwardedPath)
	target.RawQuery = request.URL.RawQuery
	outbound, err := http.NewRequestWithContext(request.Context(), request.Method, target.String(), request.Body)
	if err != nil {
		writeError(writer, http.StatusBadGateway, "unable to construct upstream request")
		return
	}
	outbound.ContentLength = request.ContentLength
	outbound.Header = sanitizedForwardHeaders(request.Header, clientIP, request.Host, request.TLS != nil)
	response, err := handler.client.Do(outbound)
	if err != nil {
		writeError(writer, http.StatusBadGateway, "upstream service is unavailable")
		return
	}
	defer response.Body.Close()
	copyResponseHeaders(writer.Header(), response.Header)
	writer.WriteHeader(response.StatusCode)
	_, _ = io.Copy(writer, response.Body)
}

func sanitizedForwardHeaders(source http.Header, clientIP, host string, tls bool) http.Header {
	result := make(http.Header, len(source)+3)
	for name, values := range source {
		lower := strings.ToLower(name)
		if _, forbidden := hopByHopHeaders[lower]; forbidden || lower == "forwarded" || strings.HasPrefix(lower, "x-forwarded-") || lower == "x-real-ip" || lower == "x-original-url" || lower == "x-rewrite-url" || lower == "x-accel-redirect" || lower == "x-aethercode-principal-id" || lower == "x-aethercode-actor-id" || lower == "x-aethercode-tenant-id" || lower == "x-aethercode-user-id" || lower == "x-aethercode-service" || lower == "x-aethercode-verified-principal-id" || strings.HasPrefix(lower, "x-aethercode-authz-") || strings.HasPrefix(lower, "x-aethercode-internal-") || lower == strings.ToLower(secureTenantHeader) || lower == strings.ToLower(secureSessionHeader) || lower == strings.ToLower(secureConfigHeader) || lower == strings.ToLower(secureBrowserHeader) {
			continue
		}
		for _, value := range values {
			result.Add(name, value)
		}
	}
	result.Set("X-Forwarded-For", clientIP)
	result.Set("X-Forwarded-Host", host)
	if tls {
		result.Set("X-Forwarded-Proto", "https")
	} else {
		result.Set("X-Forwarded-Proto", "http")
	}
	return result
}

func copyResponseHeaders(destination, source http.Header) {
	for name, values := range source {
		if _, hopByHop := hopByHopHeaders[strings.ToLower(name)]; hopByHop {
			continue
		}
		for _, value := range values {
			destination.Add(name, value)
		}
	}
}

func joinURL(base *url.URL, suffix string) *url.URL {
	copy := *base
	basePath := strings.TrimSuffix(copy.Path, "/")
	if basePath == "" {
		basePath = "/"
	}
	if suffix == "/" {
		copy.Path = basePath + "/"
	} else {
		copy.Path = strings.TrimSuffix(basePath, "/") + "/" + strings.TrimPrefix(suffix, "/")
	}
	copy.RawPath = ""
	copy.RawQuery = ""
	copy.Fragment = ""
	return &copy
}

func writeError(writer http.ResponseWriter, status int, message string) {
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(status)
	_, _ = io.WriteString(writer, `{"error":"`+message+`"}`+"\n")
}
