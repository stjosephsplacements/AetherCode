package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/authzprojection"
	"github.com/aethercode/aethercode/libs/pkg/config"
	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/libs/pkg/logging"
	"github.com/aethercode/aethercode/libs/pkg/messaging"
	"github.com/aethercode/aethercode/libs/pkg/telemetry"
	httpadapter "github.com/aethercode/aethercode/services/identity/internal/adapters/http"
	introspectionadapter "github.com/aethercode/aethercode/services/identity/internal/adapters/introspection"
	"github.com/aethercode/aethercode/services/identity/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/identity/internal/app"
	identityconfig "github.com/aethercode/aethercode/services/identity/internal/config"
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
	runContext, cancel := context.WithCancel(contextValue)
	defer cancel()
	serviceConfig, err := config.LoadService("identity")
	if err != nil {
		return err
	}
	logger, err := logging.New(serviceConfig.LogLevel)
	if err != nil {
		return err
	}
	otelShutdown, err := telemetry.InitProvider(contextValue, "identity", "0.1.0")
	if err != nil {
		logger.Warn("telemetry provider init failed, tracing disabled", "error", err)
	} else {
		defer otelShutdown(contextValue)
	}
	databaseConfig, err := config.LoadDatabase("IDENTITY")
	if err != nil {
		return err
	}
	pool, err := database.Open(runContext, databaseConfig)
	if err != nil {
		return err
	}
	defer pool.Close()
	runtime, err := identityconfig.Load(serviceConfig.Environment)
	if err != nil {
		return err
	}
	store, err := repo.NewPostgres(pool, runtime.MFAMasterKeys, runtime.MFAKeyReference)
	if err != nil {
		return err
	}
	readiness := store.Ping
	messagingRuntime, err := messaging.LoadRuntime(serviceConfig.Environment)
	if err != nil {
		return err
	}
	if messagingRuntime.URL != "" {
		outbox, outboxErr := messaging.NewOutboxStore(pool, "app.outbox_events")
		if outboxErr != nil {
			return outboxErr
		}
		publisher, publisherErr := messaging.NewPublisher(runContext, messagingRuntime.URL, serviceConfig.Name+"-outbox", outbox, logger)
		if publisherErr != nil {
			return publisherErr
		}
		go publisher.Run(runContext)
		projectionDatabaseConfig, projectionConfigErr := config.LoadDatabase("IDENTITY_PROJECTION")
		if projectionConfigErr != nil {
			return projectionConfigErr
		}
		projectionPool, projectionPoolErr := database.Open(runContext, projectionDatabaseConfig)
		if projectionPoolErr != nil {
			return projectionPoolErr
		}
		defer projectionPool.Close()
		snapshotProjection, snapshotProjectionErr := authzprojection.NewStore(projectionPool)
		if snapshotProjectionErr != nil {
			return snapshotProjectionErr
		}
		resyncProjection, resyncProjectionErr := authzprojection.NewResyncStore(projectionPool, "identity")
		if resyncProjectionErr != nil {
			return resyncProjectionErr
		}
		snapshotConsumer, snapshotConsumerErr := messaging.NewPullConsumer(
			runContext, messagingRuntime.URL, serviceConfig.Name+"-authz-snapshot",
			"identity_authz_snapshot_v1", authzprojection.SnapshotEventType, logger, snapshotProjection.Apply,
		)
		if snapshotConsumerErr != nil {
			return snapshotConsumerErr
		}
		resyncSnapshotSubject, resyncSubjectErr := authzprojection.ResyncSnapshotSubject("identity")
		if resyncSubjectErr != nil {
			return resyncSubjectErr
		}
		resyncSnapshotConsumer, resyncSnapshotConsumerErr := messaging.NewPullConsumer(
			runContext, messagingRuntime.URL, serviceConfig.Name+"-authz-resync-snapshots",
			"identity_authz_resync_snapshots_v1", resyncSnapshotSubject, logger, resyncProjection.ApplySnapshot,
		)
		if resyncSnapshotConsumerErr != nil {
			return resyncSnapshotConsumerErr
		}
		resyncCompletedSubject, resyncCompletedSubjectErr := authzprojection.ResyncCompletedSubject("identity")
		if resyncCompletedSubjectErr != nil {
			return resyncCompletedSubjectErr
		}
		resyncCompletedConsumer, resyncCompletedConsumerErr := messaging.NewPullConsumer(
			runContext, messagingRuntime.URL, serviceConfig.Name+"-authz-resync-completed",
			"identity_authz_resync_completed_v1", resyncCompletedSubject, logger, resyncProjection.ApplyCompleted,
		)
		if resyncCompletedConsumerErr != nil {
			return resyncCompletedConsumerErr
		}
		go snapshotConsumer.Run(runContext)
		go resyncSnapshotConsumer.Run(runContext)
		go resyncCompletedConsumer.Run(runContext)
		resyncMonitor, resyncMonitorErr := authzprojection.NewResyncMonitor(
			resyncProjection, logger, publisher.Ready, snapshotConsumer.Ready,
			resyncSnapshotConsumer.Ready, resyncCompletedConsumer.Ready,
		)
		if resyncMonitorErr != nil {
			return resyncMonitorErr
		}
		go resyncMonitor.Run(runContext)
		readiness = func(readinessContext context.Context) error {
			if err := store.Ping(readinessContext); err != nil {
				return err
			}
			if err := publisher.Ready(readinessContext); err != nil {
				return err
			}
			if err := snapshotProjection.Ping(readinessContext); err != nil {
				return err
			}
			if err := resyncProjection.Ping(readinessContext); err != nil {
				return err
			}
			if err := resyncProjection.Ready(readinessContext); err != nil {
				return err
			}
			for _, consumer := range []*messaging.PullConsumer{
				snapshotConsumer, resyncSnapshotConsumer, resyncCompletedConsumer,
			} {
				if err := consumer.Ready(readinessContext); err != nil {
					return err
				}
			}
			return nil
		}
	}
	identityService, err := app.NewService(store, app.Options{
		Signer:                    runtime.AccessSigner,
		AccessTokenLifetime:       runtime.AccessTokenLifetime,
		RefreshTokenLifetime:      runtime.RefreshTokenLifetime,
		EmailVerificationLifetime: runtime.EmailVerificationLifetime,
		PasswordResetLifetime:     runtime.PasswordResetLifetime,
		MFAChallengeLifetime:      runtime.MFAChallengeLifetime,
		LockoutThreshold:          runtime.LockoutThreshold,
		LockoutDuration:           runtime.LockoutDuration,
		DeliveryTokenKey:          runtime.DeliveryTokenKey,
	})
	if err != nil {
		return err
	}
	_, handler, err := httpadapter.NewHandler(
		serviceConfig.Name, identityService, readiness, runtime.AccessVerifier, runtime.ExposeDevelopmentSecrets,
	)
	if err != nil {
		return err
	}
	handler = telemetry.HTTPMiddleware("identity", handler)
	introspectionHandler, err := introspectionadapter.NewHandler(
		identityService, runtime.AccessVerifier, runtime.IntrospectionTrustedSPIFFEID, runtime.RequireIntrospectionMTLS,
	)
	if err != nil {
		return err
	}
	privateErrors := make(chan error, 1)
	go func() {
		privateErrors <- serveIntrospection(runContext, serviceConfig, runtime, introspectionHandler, logger)
	}()
	publicErrors := make(chan error, 1)
	go func() {
		publicErrors <- httpx.Serve(runContext, serviceConfig, logger, handler)
	}()
	select {
	case err := <-privateErrors:
		return err
	case err := <-publicErrors:
		return err
	}
}

func serveIntrospection(
	contextValue context.Context,
	serviceConfig config.Service,
	runtime identityconfig.Runtime,
	handler http.Handler,
	logger *slog.Logger,
) error {
	listener, err := net.Listen("tcp", runtime.IntrospectionAddress)
	if err != nil {
		return fmt.Errorf("listen for Identity introspection: %w", err)
	}
	defer func() { _ = listener.Close() }()
	if runtime.RequireIntrospectionMTLS {
		tlsConfig, err := config.LoadMTLSServerConfig(
			runtime.IntrospectionCertificateFile, runtime.IntrospectionKeyFile, runtime.IntrospectionClientCAFile,
		)
		if err != nil {
			return fmt.Errorf("load Identity introspection mTLS configuration: %w", err)
		}
		if tlsConfig.MinVersion != tls.VersionTLS13 {
			return fmt.Errorf("identity introspection must require TLS 1.3")
		}
		listener = tls.NewListener(listener, tlsConfig)
	}
	server := &http.Server{
		Addr:              runtime.IntrospectionAddress,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	serverErrors := make(chan error, 1)
	go func() {
		logger.Info("Identity introspection listening", "address", runtime.IntrospectionAddress, "mtls", runtime.RequireIntrospectionMTLS)
		if serveErr := server.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			serverErrors <- serveErr
		}
	}()
	select {
	case err := <-serverErrors:
		return fmt.Errorf("serve Identity introspection: %w", err)
	case <-contextValue.Done():
		shutdownContext, cancel := context.WithTimeout(context.Background(), serviceConfig.ShutdownTimeout)
		defer cancel()
		if err := server.Shutdown(shutdownContext); err != nil {
			return fmt.Errorf("shutdown Identity introspection: %w", err)
		}
		return nil
	}
}
