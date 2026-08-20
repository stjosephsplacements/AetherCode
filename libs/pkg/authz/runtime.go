package authz

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
	"strings"
	"time"

	authzv1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/authz/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

// ClientRuntime is the fail-closed configuration shared by every protected
// platform service when it calls the canonical User authorization service.
type ClientRuntime struct {
	Endpoint        string
	CertificateFile string
	KeyFile         string
	CAFile          string
	ServerName      string
	RequireMTLS     bool
}

// LoadClientRuntime reads only authorization-client settings. In staging and
// production an mTLS client identity and CA are mandatory; insecure transport
// is permitted solely for isolated development/test profiles.
func LoadClientRuntime(environment string) (ClientRuntime, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	runtime := ClientRuntime{
		Endpoint:        strings.TrimSpace(env("AUTHZ_ENDPOINT", "127.0.0.1:9443")),
		CertificateFile: strings.TrimSpace(env("AUTHZ_CLIENT_TLS_CERT_FILE", "")),
		KeyFile:         strings.TrimSpace(env("AUTHZ_CLIENT_TLS_KEY_FILE", "")),
		CAFile:          strings.TrimSpace(env("AUTHZ_CLIENT_TLS_CA_FILE", "")),
		ServerName:      strings.TrimSpace(env("AUTHZ_CLIENT_TLS_SERVER_NAME", "")),
		RequireMTLS:     environment == "staging" || environment == "production",
	}
	if runtime.Endpoint == "" || !strings.Contains(runtime.Endpoint, ":") {
		return ClientRuntime{}, fmt.Errorf("AUTHZ_ENDPOINT must include a host and port")
	}
	configuredFiles := 0
	for _, path := range []string{runtime.CertificateFile, runtime.KeyFile, runtime.CAFile} {
		if path != "" {
			configuredFiles++
		}
	}
	if runtime.RequireMTLS && configuredFiles != 3 {
		return ClientRuntime{}, fmt.Errorf("authorization client TLS certificate, key, and CA are required in %s", environment)
	}
	if !runtime.RequireMTLS && configuredFiles != 0 && configuredFiles != 3 {
		return ClientRuntime{}, fmt.Errorf("authorization client TLS certificate, key, and CA must be configured together")
	}
	if configuredFiles == 3 {
		runtime.RequireMTLS = true
	}
	return runtime, nil
}

// DialClient opens one long-lived gRPC connection to the central User service.
// There is no decision cache: every protected operation still invokes
// Authorize over this mTLS channel.
func DialClient(contextValue context.Context, runtime ClientRuntime) (*Client, *grpc.ClientConn, error) {
	var transportCredentials credentials.TransportCredentials
	if runtime.RequireMTLS {
		tlsConfig, err := loadClientTLSConfig(runtime)
		if err != nil {
			return nil, nil, err
		}
		transportCredentials = credentials.NewTLS(tlsConfig)
	} else {
		transportCredentials = insecure.NewCredentials()
	}
	dialContext, cancel := context.WithTimeout(contextValue, 5*time.Second)
	defer cancel()
	//nolint:staticcheck // SA1019: blocking dial is load-bearing for startup readiness; every caller treats a failed dial here as a fatal startup error, so services fail fast instead of starting without central authorization. Migrate alongside a readiness rework.
	connection, err := grpc.DialContext(dialContext, runtime.Endpoint, grpc.WithTransportCredentials(transportCredentials), grpc.WithBlock())
	if err != nil {
		return nil, nil, fmt.Errorf("dial central authorization service: %w", err)
	}
	client, err := NewClient(authzv1.NewAuthorizationServiceClient(connection))
	if err != nil {
		_ = connection.Close()
		return nil, nil, err
	}
	return client, connection, nil
}

func loadClientTLSConfig(runtime ClientRuntime) (*tls.Config, error) {
	certificate, err := tls.LoadX509KeyPair(runtime.CertificateFile, runtime.KeyFile)
	if err != nil {
		return nil, fmt.Errorf("load authorization client TLS certificate: %w", err)
	}
	caPEM, err := os.ReadFile(runtime.CAFile)
	if err != nil {
		return nil, fmt.Errorf("read authorization client CA: %w", err)
	}
	rootCAs := x509.NewCertPool()
	if !rootCAs.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("authorization client CA contains no certificates")
	}
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{certificate},
		RootCAs:      rootCAs,
		ServerName:   runtime.ServerName,
	}, nil
}

func env(key, fallback string) string {
	if value, found := os.LookupEnv(key); found {
		return value
	}
	return fallback
}
