// Package httpx hosts common HTTP server lifecycle and operational handlers.
package httpx

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/config"
	"github.com/aethercode/aethercode/libs/pkg/logging"
	"github.com/aethercode/aethercode/libs/pkg/telemetry"
)

// ReadinessFunc reports whether a service can safely receive work.
type ReadinessFunc func(context.Context) error

// Run starts an operational HTTP server and gracefully stops it when context
// cancellation is requested. Business routes are registered by each service
// adapter as its phase is implemented.
func Run(contextValue context.Context, defaultServiceName string) error {
	service, err := config.LoadService(defaultServiceName)
	if err != nil {
		return err
	}
	logger, err := logging.New(service.LogLevel)
	if err != nil {
		return err
	}

	return Serve(contextValue, service, logger, NewOperationalHandler(service.Name, nil))
}

// NewOperationalHandler returns the live, ready, and Prometheus endpoints
// shared by service adapters. A nil readiness function means the process has
// no external dependency at this phase.
func NewOperationalHandler(service string, readiness ReadinessFunc) http.Handler {
	return NewOperationalMux(service, readiness)
}

// NewOperationalMux returns a mutable mux containing the common operational
// routes. Service adapters register their business routes on this mux before
// passing it to Serve.
func NewOperationalMux(service string, readiness ReadinessFunc) *http.ServeMux {
	mux := http.NewServeMux()
	metrics := telemetry.NewRegistry(service)
	mux.Handle("GET /healthz", healthHandler(service))
	mux.Handle("GET /readyz", readinessHandler(service, readiness))
	mux.Handle("GET /metrics", metrics.Handler())
	return mux
}

// Serve runs an already configured operational HTTP server and gracefully
// stops it when context cancellation is requested.
func Serve(contextValue context.Context, service config.Service, logger *slog.Logger, handler http.Handler) error {
	server := &http.Server{
		Addr:              service.HTTPAddress,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	serverErrors := make(chan error, 1)
	go func() {
		logger.Info("service listening", "service", service.Name, "address", service.HTTPAddress)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErrors <- err
		}
	}()

	select {
	case err := <-serverErrors:
		return fmt.Errorf("serve HTTP: %w", err)
	case <-contextValue.Done():
		shutdownContext, cancel := context.WithTimeout(context.Background(), service.ShutdownTimeout)
		defer cancel()
		if err := server.Shutdown(shutdownContext); err != nil {
			return fmt.Errorf("shutdown HTTP: %w", err)
		}
		return nil
	}
}

func healthHandler(service string) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprintf(writer, `{"service":%q,"status":"ok"}`+"\n", service)
	})
}

func readinessHandler(service string, readiness ReadinessFunc) http.Handler {
	if readiness == nil {
		return healthHandler(service)
	}
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if err := readiness(request.Context()); err != nil {
			writer.Header().Set("Content-Type", "application/json")
			writer.WriteHeader(http.StatusServiceUnavailable)
			_, _ = fmt.Fprintf(writer, `{"service":%q,"status":"not_ready"}`+"\n", service)
			return
		}
		healthHandler(service).ServeHTTP(writer, request)
	})
}
