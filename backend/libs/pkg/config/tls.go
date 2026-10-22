package config

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
	"strings"
)

// LoadMTLSServerConfig builds a TLS 1.3 configuration that requires and
// verifies a client certificate. The three file paths are intentionally
// supplied by a workload's secret mount, never by the repository.
func LoadMTLSServerConfig(certificateFile, keyFile, clientCAFile string) (*tls.Config, error) {
	certificateFile = strings.TrimSpace(certificateFile)
	keyFile = strings.TrimSpace(keyFile)
	clientCAFile = strings.TrimSpace(clientCAFile)
	if certificateFile == "" || keyFile == "" || clientCAFile == "" {
		return nil, fmt.Errorf("TLS certificate, key, and client CA files are required")
	}

	certificate, err := tls.LoadX509KeyPair(certificateFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("load TLS certificate: %w", err)
	}
	clientCAPEM, err := os.ReadFile(clientCAFile)
	if err != nil {
		return nil, fmt.Errorf("read TLS client CA: %w", err)
	}
	clientCAs := x509.NewCertPool()
	if !clientCAs.AppendCertsFromPEM(clientCAPEM) {
		return nil, fmt.Errorf("TLS client CA contains no certificates")
	}

	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{certificate},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    clientCAs,
	}, nil
}

// LoadMTLSClientConfig builds a TLS 1.3 client configuration that presents the
// workload's certificate and trusts only the platform CA. serverName is the
// name the server's certificate must carry.
func LoadMTLSClientConfig(certificateFile, keyFile, caFile, serverName string) (*tls.Config, error) {
	certificate, err := tls.LoadX509KeyPair(strings.TrimSpace(certificateFile), strings.TrimSpace(keyFile))
	if err != nil {
		return nil, fmt.Errorf("load TLS client certificate: %w", err)
	}
	caPEM, err := os.ReadFile(strings.TrimSpace(caFile))
	if err != nil {
		return nil, fmt.Errorf("read TLS server CA: %w", err)
	}
	rootCAs := x509.NewCertPool()
	if !rootCAs.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("TLS server CA contains no certificates")
	}
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{certificate},
		RootCAs:      rootCAs,
		ServerName:   strings.TrimSpace(serverName),
	}, nil
}
