package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/config"
	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/libs/pkg/logging"
	"github.com/aethercode/aethercode/libs/pkg/telemetry"
	judgev1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/judge/v1"
	amqpadapter "github.com/aethercode/aethercode/services/judge/internal/adapters/amqp"
	grpcadapter "github.com/aethercode/aethercode/services/judge/internal/adapters/grpc"
	"github.com/aethercode/aethercode/services/judge/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/judge/internal/app"
	judgeconfig "github.com/aethercode/aethercode/services/judge/internal/config"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	grpcHealth "google.golang.org/grpc/health"
	grpcHealthV1 "google.golang.org/grpc/health/grpc_health_v1"
)

func main() {
	contextValue, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(contextValue); err != nil {
		slog.Error("Judge service stopped", "error", err)
		os.Exit(1)
	}
}

func run(contextValue context.Context) error {
	serviceConfig, err := config.LoadService("judge")
	if err != nil {
		return err
	}
	logger, err := logging.New(serviceConfig.LogLevel)
	if err != nil {
		return err
	}
	otelShutdown, err := telemetry.InitProvider(contextValue, "judge", "0.1.0")
	if err != nil {
		logger.Warn("telemetry provider init failed, tracing disabled", "error", err)
	} else {
		defer otelShutdown(contextValue)
	}
	databaseConfig, err := config.LoadDatabase("JUDGE")
	if err != nil {
		return err
	}
	pool, err := database.Open(contextValue, databaseConfig)
	if err != nil {
		return err
	}
	defer pool.Close()
	runtime, err := judgeconfig.Load(serviceConfig.Environment)
	if err != nil {
		return err
	}

	store := repo.NewPostgres(pool)
	judgeService := app.NewService(store)
	readiness := store.Ping
	if runtime.RabbitURL != "" {
		publisher, publisherErr := amqpadapter.NewPublisher(runtime.RabbitURL, runtime.PublisherID, store, logger)
		if publisherErr != nil {
			return publisherErr
		}
		go publisher.Run(contextValue)
		readiness = func(readinessContext context.Context) error {
			if err := store.Ping(readinessContext); err != nil {
				return err
			}
			return publisher.Ready(readinessContext)
		}
	}
	listener, err := net.Listen("tcp", runtime.GRPCAddress)
	if err != nil {
		return fmt.Errorf("listen for Judge gRPC: %w", err)
	}
	defer func() { _ = listener.Close() }()

	grpcOptions, err := grpcOptionsFor(runtime)
	if err != nil {
		return err
	}
	grpcServer := grpc.NewServer(grpcOptions...)
	judgev1.RegisterJudgeServiceServer(grpcServer, grpcadapter.NewServer(judgeService))
	healthServer := grpcHealth.NewServer()
	healthServer.SetServingStatus("", grpcHealthV1.HealthCheckResponse_SERVING)
	grpcHealthV1.RegisterHealthServer(grpcServer, healthServer)

	grpcErrors := make(chan error, 1)
	go func() {
		logger.Info("Judge gRPC listening", "address", runtime.GRPCAddress, "mtls", runtime.RequireMTLS)
		if serveErr := grpcServer.Serve(listener); serveErr != nil {
			grpcErrors <- fmt.Errorf("serve Judge gRPC: %w", serveErr)
		}
	}()

	httpErrors := make(chan error, 1)
	go func() {
		httpErrors <- httpx.Serve(
			contextValue,
			serviceConfig,
			logger,
			telemetry.HTTPMiddleware("judge", httpx.NewOperationalHandler(serviceConfig.Name, readiness)),
		)
	}()

	select {
	case err := <-grpcErrors:
		return err
	case err := <-httpErrors:
		return err
	case <-contextValue.Done():
		healthServer.SetServingStatus("", grpcHealthV1.HealthCheckResponse_NOT_SERVING)
		gracefulStop(grpcServer, serviceConfig.ShutdownTimeout)
		if err := <-httpErrors; err != nil {
			return fmt.Errorf("shut down Judge health server: %w", err)
		}
		return nil
	}
}

func grpcOptionsFor(runtime judgeconfig.Runtime) ([]grpc.ServerOption, error) {
	if !runtime.RequireMTLS {
		return nil, nil
	}
	tlsConfig, err := config.LoadMTLSServerConfig(runtime.CertificateFile, runtime.KeyFile, runtime.ClientCAFile)
	if err != nil {
		return nil, fmt.Errorf("load Judge mTLS configuration: %w", err)
	}
	if tlsConfig.MinVersion != tls.VersionTLS13 {
		return nil, fmt.Errorf("judge mTLS must require TLS 1.3")
	}
	return []grpc.ServerOption{
		grpc.Creds(credentials.NewTLS(tlsConfig)),
		grpc.UnaryInterceptor(grpcadapter.RequireClientSubjects(runtime.AllowedSubjects)),
	}, nil
}

func gracefulStop(server *grpc.Server, timeout time.Duration) {
	done := make(chan struct{})
	go func() {
		server.GracefulStop()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(timeout):
		server.Stop()
	}
}
