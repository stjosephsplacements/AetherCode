// Package config loads and validates service configuration from the environment.
package config

import (
	"fmt"
	"os"
	"strings"
	"time"
)

// Service is the minimum configuration required by every independently
// deployable AetherCode service.
type Service struct {
	Name            string
	Environment     string
	HTTPAddress     string
	LogLevel        string
	ShutdownTimeout time.Duration
}

// LoadService returns validated service runtime settings. Environment values
// intentionally have narrow defaults so an accidental production deployment
// does not silently bind to a public address or wait indefinitely to stop.
func LoadService(defaultName string) (Service, error) {
	name := value("SERVICE_NAME", defaultName)
	if strings.TrimSpace(name) == "" {
		return Service{}, fmt.Errorf("SERVICE_NAME must not be empty")
	}

	address := value("HTTP_ADDR", ":8080")
	if !strings.Contains(address, ":") {
		return Service{}, fmt.Errorf("HTTP_ADDR must include a port: %q", address)
	}

	shutdownTimeout, err := time.ParseDuration(value("SHUTDOWN_TIMEOUT", "10s"))
	if err != nil || shutdownTimeout <= 0 {
		return Service{}, fmt.Errorf("SHUTDOWN_TIMEOUT must be a positive duration")
	}

	environment := strings.ToLower(strings.TrimSpace(value("AETHERCODE_ENV", "development")))
	switch environment {
	case "development", "test", "staging", "production":
	default:
		return Service{}, fmt.Errorf("AETHERCODE_ENV must be development, test, staging, or production")
	}

	return Service{
		Name:            name,
		Environment:     environment,
		HTTPAddress:     address,
		LogLevel:        strings.ToLower(value("LOG_LEVEL", "info")),
		ShutdownTimeout: shutdownTimeout,
	}, nil
}

func value(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
