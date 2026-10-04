// Package config loads Question Bank settings that the shared libs/pkg/config
// loaders do not cover.
package config

import (
	"fmt"
	"os"
	"strings"
)

// GRPC is the internal service listener (QuestionBankInternalService).
type GRPC struct {
	Address         string
	CertificateFile string
	KeyFile         string
	ClientCAFile    string
	AllowedSubjects []string
	RequireMTLS     bool
}

// LoadGRPC requires mTLS and a client allow-list in staging and production.
// Elsewhere the TLS files are all-or-none.
func LoadGRPC(environment string) (GRPC, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	runtime := GRPC{
		Address:         value("QBANK_GRPC_ADDR", "127.0.0.1:9445"),
		CertificateFile: value("QBANK_GRPC_TLS_CERT_FILE", ""),
		KeyFile:         value("QBANK_GRPC_TLS_KEY_FILE", ""),
		ClientCAFile:    value("QBANK_GRPC_CLIENT_CA_FILE", ""),
		RequireMTLS:     environment == "staging" || environment == "production",
	}
	for _, subject := range strings.Split(value("QBANK_GRPC_ALLOWED_CLIENT_SUBJECTS", ""), ",") {
		if subject = strings.TrimSpace(subject); subject != "" {
			runtime.AllowedSubjects = append(runtime.AllowedSubjects, subject)
		}
	}
	if !strings.Contains(runtime.Address, ":") {
		return GRPC{}, fmt.Errorf("QBANK_GRPC_ADDR must include a host and port")
	}
	configured := 0
	for _, file := range []string{runtime.CertificateFile, runtime.KeyFile, runtime.ClientCAFile} {
		if file != "" {
			configured++
		}
	}
	if runtime.RequireMTLS && configured != 3 {
		return GRPC{}, fmt.Errorf("question bank gRPC TLS certificate, key, and client CA are required in %s", environment)
	}
	if !runtime.RequireMTLS && configured != 0 && configured != 3 {
		return GRPC{}, fmt.Errorf("question bank gRPC TLS certificate, key, and client CA must be configured together")
	}
	runtime.RequireMTLS = configured == 3
	if runtime.RequireMTLS && len(runtime.AllowedSubjects) == 0 {
		return GRPC{}, fmt.Errorf("QBANK_GRPC_ALLOWED_CLIENT_SUBJECTS is required when gRPC mTLS is enabled")
	}
	return runtime, nil
}

func value(key, fallback string) string {
	if configured := strings.TrimSpace(os.Getenv(key)); configured != "" {
		return configured
	}
	return fallback
}
