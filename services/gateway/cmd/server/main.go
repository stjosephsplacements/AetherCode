package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/aethercode/aethercode/libs/pkg/config"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/libs/pkg/logging"
	gatewayconfig "github.com/aethercode/aethercode/services/gateway/internal/config"
	"github.com/aethercode/aethercode/services/gateway/internal/edge"
)

func main() {
	contextValue, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(contextValue); err != nil {
		slog.Error("service stopped", "error", err)
		os.Exit(1)
	}
}

func run(contextValue context.Context) error {
	serviceConfig, err := config.LoadService("gateway")
	if err != nil {
		return err
	}
	logger, err := logging.New(serviceConfig.LogLevel)
	if err != nil {
		return err
	}
	runtime, err := gatewayconfig.Load()
	if err != nil {
		return err
	}
	limiter, err := edge.NewLimiter(edge.RateLimitConfig{
		Capacity:        runtime.RateLimit.Capacity,
		RefillPerSecond: runtime.RateLimit.RefillPerSecond,
		MaxEntries:      runtime.RateLimit.MaxEntries,
		IdleTTL:         runtime.RateLimit.IdleTTL,
	})
	if err != nil {
		return err
	}
	handler, err := edge.New(edge.Config{
		Upstreams:            runtime.Upstreams,
		Verifier:             runtime.Verifier,
		Limiter:              limiter,
		TrustedProxyCIDRs:    runtime.TrustedProxyCIDRs,
		SEBProtectedPrefixes: runtime.SEBProtectedPrefixes,
		RequestTimeout:       runtime.RequestTimeout,
		SEBValidationTimeout: runtime.SEBValidationTimeout,
	})
	if err != nil {
		return err
	}
	mux := httpx.NewOperationalMux(serviceConfig.Name, handler.Ready)
	mux.Handle("/api/", handler)
	return httpx.Serve(contextValue, serviceConfig, logger, mux)
}
