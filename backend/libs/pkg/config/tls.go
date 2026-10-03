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
