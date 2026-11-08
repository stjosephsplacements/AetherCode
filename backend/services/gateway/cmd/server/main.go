package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/buildinfo"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/config"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/httpx"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/logging"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/ratelimit"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/telemetry"
	gatewayconfig "github.com/stjosephsplacements/AetherCode/services/gateway/internal/config"
	"github.com/stjosephsplacements/AetherCode/services/gateway/internal/edge"
	"github.com/stjosephsplacements/AetherCode/services/gateway/internal/realtime"
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
	otelShutdown, err := telemetry.InitProvider(contextValue, "gateway", buildinfo.Version)
	if err != nil {
		logger.Warn("telemetry provider init failed, tracing disabled", "error", err)
	} else {
		defer func() {
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			otelShutdown(shutdownCtx)
		}()
	}
	runtime, err := gatewayconfig.Load()
	if err != nil {
		return err
	}
	limiter, err := ratelimit.New(ratelimit.Config{
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
		SEBPublicOrigin:      runtime.SEBPublicOrigin,
		RequestTimeout:       runtime.RequestTimeout,
		SEBValidationTimeout: runtime.SEBValidationTimeout,
	})
	if err != nil {
		return err
	}
	live, err := startRealtime(contextValue, runtime, logger)
	if err != nil {
		return err
	}
	mux := httpx.NewOperationalMux(serviceConfig.Name, handler.Ready)
	mux.Handle("/api/realtime", live)
	mux.Handle("/api/realtime/", live)
	mux.Handle("/api/", handler)
	return httpx.Serve(contextValue, serviceConfig, logger, telemetry.HTTPMiddleware("gateway", mux))
}

// startRealtime starts service health probing and, when NATS is configured,
// the event hints (ADR-0050). Hints are best-effort: a lost broker leaves health running.
func startRealtime(contextValue context.Context, runtime gatewayconfig.Runtime, logger *slog.Logger) (*realtime.Server, error) {
	client := &http.Client{Timeout: runtime.RequestTimeout}
	hub := realtime.NewHub(8)
	prober := realtime.NewProber(runtime.Upstreams, runtime.Realtime.Descriptions, client, runtime.Realtime.HealthInterval)
	go prober.Run(contextValue, hub.PublishHealth)
	if runtime.Realtime.NATSURL != "" {
		// Keep retrying in the background: a broker outage pauses hints, never the gateway.
		connection, err := nats.Connect(runtime.Realtime.NATSURL, nats.Name("gateway-realtime"), nats.Timeout(5*time.Second), nats.RetryOnFailedConnect(true), nats.MaxReconnects(-1),
			nats.DisconnectErrHandler(func(_ *nats.Conn, err error) { logger.Warn("realtime hints paused: NATS disconnected", "error", err) }),
			nats.ReconnectHandler(func(*nats.Conn) { logger.Info("realtime hints resumed: NATS reconnected") }))
		if err != nil {
			return nil, fmt.Errorf("configure realtime NATS connection: %w", err)
		}
		for _, subject := range realtime.Subjects {
			if _, err := connection.Subscribe(subject, func(message *nats.Msg) { hub.PublishEvent(message.Data) }); err != nil {
				connection.Close()
				return nil, fmt.Errorf("subscribe to %s: %w", subject, err)
			}
		}
		go func() {
			<-contextValue.Done()
			connection.Close()
		}()
	} else {
		logger.Info("realtime event hints disabled: GATEWAY_REALTIME_NATS_URL is not set")
	}
	return realtime.NewServer(realtime.Config{
		Verifier:    runtime.Verifier,
		Hub:         hub,
		Prober:      prober,
		UserService: runtime.Upstreams["user"],
		Client:      client,
		Origins:     runtime.Realtime.Origins,
		Cookie:      runtime.Realtime.Cookie,
	})
}
