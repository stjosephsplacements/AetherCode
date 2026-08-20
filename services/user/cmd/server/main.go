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

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/authzprojection"
	"github.com/aethercode/aethercode/libs/pkg/config"
	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/aethercode/aethercode/libs/pkg/httpauth"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/libs/pkg/logging"
	"github.com/aethercode/aethercode/libs/pkg/messaging"
	authzv1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/authz/v1"
	authnadapter "github.com/aethercode/aethercode/services/user/internal/adapters/authn"
	grpcadapter "github.com/aethercode/aethercode/services/user/internal/adapters/grpc"
	httpadapter "github.com/aethercode/aethercode/services/user/internal/adapters/http"
	projectionadapter "github.com/aethercode/aethercode/services/user/internal/adapters/projection"
	"github.com/aethercode/aethercode/services/user/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/user/internal/app"
	authzconfig "github.com/aethercode/aethercode/services/user/internal/config"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	grpcHealth "google.golang.org/grpc/health"
	grpcHealthV1 "google.golang.org/grpc/health/grpc_health_v1"
)

func main() {
	contextValue, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(contextValue); err != nil {
		slog.Error("User authorization service stopped", "error", err)
		os.Exit(1)
	}
}

func run(contextValue context.Context) error {
	serviceConfig, err := config.LoadService("user")
	if err != nil {
		return err
	}
	logger, err := logging.New(serviceConfig.LogLevel)
	if err != nil {
		return err
	}
	authzDatabaseConfig, err := config.LoadDatabase("USER_AUTHZ")
	if err != nil {
		return err
	}
	authzPool, err := database.Open(contextValue, authzDatabaseConfig)
	if err != nil {
		return err
	}
	defer authzPool.Close()
	userDatabaseConfig, err := config.LoadDatabase("USER")
	if err != nil {
		return err
	}
	userPool, err := database.Open(contextValue, userDatabaseConfig)
	if err != nil {
		return err
	}
	defer userPool.Close()
	runtime, err := authzconfig.Load(serviceConfig.Environment)
	if err != nil {
		return err
	}

	authzStore := repo.NewPostgres(authzPool)
	managementStore := repo.NewPostgres(userPool)
	sessionValidator, err := authnadapter.NewSessionValidator(runtime.IdentityIntrospection)
	if err != nil {
		return fmt.Errorf("configure Identity access-token session validation: %w", err)
	}
	identityAssertionVerifier, err := authnadapter.NewAssertionVerifier(runtime.IdentityAssertionVerifier, sessionValidator)
	if err != nil {
		return fmt.Errorf("configure identity assertion verification: %w", err)
	}
	authorizationService, err := app.NewService(authzStore, runtime.Keyring, identityAssertionVerifier, true)
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", runtime.GRPCAddress)
	if err != nil {
		return fmt.Errorf("listen for authorization gRPC: %w", err)
	}
	defer listener.Close()
	grpcOptions, err := grpcOptionsFor(runtime)
	if err != nil {
		return err
	}
	grpcServer := grpc.NewServer(grpcOptions...)
	authzv1.RegisterAuthorizationServiceServer(grpcServer, grpcadapter.NewServer(authorizationService, runtime.RequireMTLS))
	healthServer := grpcHealth.NewServer()
	healthServer.SetServingStatus("", grpcHealthV1.HealthCheckResponse_SERVING)
	grpcHealthV1.RegisterHealthServer(grpcServer, healthServer)

	grpcErrors := make(chan error, 1)
	go func() {
		logger.Info("User authorization gRPC listening", "address", runtime.GRPCAddress, "mtls", runtime.RequireMTLS)
		if serveErr := grpcServer.Serve(listener); serveErr != nil {
			grpcErrors <- fmt.Errorf("serve authorization gRPC: %w", serveErr)
		}
	}()

	clientRuntime, err := centralauthz.LoadClientRuntime(serviceConfig.Environment)
	if err != nil {
		grpcServer.Stop()
		return err
	}
	client, connection, err := centralauthz.DialClient(contextValue, clientRuntime)
	if err != nil {
		grpcServer.Stop()
		return err
	}
	defer connection.Close()
	authorizer, err := httpauth.New(client, "user")
	if err != nil {
		grpcServer.Stop()
		return err
	}
	managementService, err := app.NewManagementService(userPool, managementStore)
	if err != nil {
		grpcServer.Stop()
		return err
	}
	readiness := func(readinessContext context.Context) error {
		if err := authzStore.Ping(readinessContext); err != nil {
			return err
		}
		return managementStore.Ping(readinessContext)
	}
	messagingRuntime, err := messaging.LoadRuntime(serviceConfig.Environment)
	if err != nil {
		grpcServer.Stop()
		return err
	}
	if messagingRuntime.URL != "" {
		outbox, outboxErr := messaging.NewOutboxStore(userPool, "app.outbox_events")
		if outboxErr != nil {
			grpcServer.Stop()
			return outboxErr
		}
		publisher, publisherErr := messaging.NewPublisher(contextValue, messagingRuntime.URL, serviceConfig.Name+"-outbox", outbox, logger)
		if publisherErr != nil {
			grpcServer.Stop()
			return publisherErr
		}
		go publisher.Run(contextValue)
		projectionDatabaseConfig, projectionConfigErr := config.LoadDatabase("USER_PROJECTION")
		if projectionConfigErr != nil {
			grpcServer.Stop()
			return projectionConfigErr
		}
		projectionPool, projectionPoolErr := database.Open(contextValue, projectionDatabaseConfig)
		if projectionPoolErr != nil {
			grpcServer.Stop()
			return projectionPoolErr
		}
		defer projectionPool.Close()
		tenantProjection, tenantProjectionErr := projectionadapter.NewTenantProjection(projectionPool)
		if tenantProjectionErr != nil {
			grpcServer.Stop()
			return tenantProjectionErr
		}
		assessmentProjection, assessmentProjectionErr := projectionadapter.NewAssessmentProjection(projectionPool)
		if assessmentProjectionErr != nil {
			grpcServer.Stop()
			return assessmentProjectionErr
		}
		resyncRequestProjection, resyncRequestProjectionErr := projectionadapter.NewAuthorizationResyncRequestProjection(projectionPool)
		if resyncRequestProjectionErr != nil {
			grpcServer.Stop()
			return resyncRequestProjectionErr
		}
		snapshotProjection, snapshotProjectionErr := authzprojection.NewStore(projectionPool)
		if snapshotProjectionErr != nil {
			grpcServer.Stop()
			return snapshotProjectionErr
		}
		resyncProjection, resyncProjectionErr := authzprojection.NewResyncStore(projectionPool, "user")
		if resyncProjectionErr != nil {
			grpcServer.Stop()
			return resyncProjectionErr
		}
		projectionConsumers := make([]*messaging.PullConsumer, 0, 8)
		for _, consumerConfig := range []struct {
			durable string
			subject string
		}{
			{durable: "user_tenant_college_department_v1", subject: "tenant.department.created.v1"},
			{durable: "user_tenant_placement_department_v1", subject: "tenant.placement_department.created.v1"},
			{durable: "user_tenant_batch_v1", subject: "tenant.batch.created.v1"},
		} {
			consumer, consumerErr := messaging.NewPullConsumer(
				contextValue, messagingRuntime.URL, serviceConfig.Name+"-"+consumerConfig.durable,
				consumerConfig.durable, consumerConfig.subject, logger, tenantProjection.Apply,
			)
			if consumerErr != nil {
				grpcServer.Stop()
				return consumerErr
			}
			projectionConsumers = append(projectionConsumers, consumer)
			go consumer.Run(contextValue)
		}
		assessmentConsumer, assessmentConsumerErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-assessment-candidate-assignment",
			"user_assessment_candidate_assignment_snapshot_v1", "assessment.candidate_assignment.snapshot.v1",
			logger, assessmentProjection.Apply,
		)
		if assessmentConsumerErr != nil {
			grpcServer.Stop()
			return assessmentConsumerErr
		}
		projectionConsumers = append(projectionConsumers, assessmentConsumer)
		go assessmentConsumer.Run(contextValue)
		snapshotConsumer, snapshotConsumerErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-authz-snapshot",
			"user_authz_snapshot_v1", authzprojection.SnapshotEventType, logger, snapshotProjection.Apply,
		)
		if snapshotConsumerErr != nil {
			grpcServer.Stop()
			return snapshotConsumerErr
		}
		projectionConsumers = append(projectionConsumers, snapshotConsumer)
		go snapshotConsumer.Run(contextValue)
		resyncRequestConsumer, resyncRequestConsumerErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-authz-resync-requests",
			"user_authz_resync_requests_v1", authzprojection.ResyncRequestWildcardSubject,
			logger, resyncRequestProjection.Apply,
		)
		if resyncRequestConsumerErr != nil {
			grpcServer.Stop()
			return resyncRequestConsumerErr
		}
		projectionConsumers = append(projectionConsumers, resyncRequestConsumer)
		go resyncRequestConsumer.Run(contextValue)
		resyncSnapshotSubject, resyncSubjectErr := authzprojection.ResyncSnapshotSubject("user")
		if resyncSubjectErr != nil {
			grpcServer.Stop()
			return resyncSubjectErr
		}
		resyncSnapshotConsumer, resyncSnapshotConsumerErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-authz-resync-snapshots",
			"user_authz_resync_snapshots_v1", resyncSnapshotSubject,
			logger, resyncProjection.ApplySnapshot,
		)
		if resyncSnapshotConsumerErr != nil {
			grpcServer.Stop()
			return resyncSnapshotConsumerErr
		}
		projectionConsumers = append(projectionConsumers, resyncSnapshotConsumer)
		go resyncSnapshotConsumer.Run(contextValue)
		resyncCompletionSubject, resyncCompletionSubjectErr := authzprojection.ResyncCompletedSubject("user")
		if resyncCompletionSubjectErr != nil {
			grpcServer.Stop()
			return resyncCompletionSubjectErr
		}
		resyncCompletionConsumer, resyncCompletionConsumerErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-authz-resync-completed",
			"user_authz_resync_completed_v1", resyncCompletionSubject,
			logger, resyncProjection.ApplyCompleted,
		)
		if resyncCompletionConsumerErr != nil {
			grpcServer.Stop()
			return resyncCompletionConsumerErr
		}
		projectionConsumers = append(projectionConsumers, resyncCompletionConsumer)
		go resyncCompletionConsumer.Run(contextValue)
		resyncMonitor, resyncMonitorErr := authzprojection.NewResyncMonitor(
			resyncProjection,
			logger,
			publisher.Ready,
			snapshotConsumer.Ready,
			resyncSnapshotConsumer.Ready,
			resyncCompletionConsumer.Ready,
		)
		if resyncMonitorErr != nil {
			grpcServer.Stop()
			return resyncMonitorErr
		}
		go resyncMonitor.Run(contextValue)
		priorReadiness := readiness
		readiness = func(readinessContext context.Context) error {
			if err := priorReadiness(readinessContext); err != nil {
				return err
			}
			if err := publisher.Ready(readinessContext); err != nil {
				return err
			}
			if err := tenantProjection.Ping(readinessContext); err != nil {
				return err
			}
			if err := assessmentProjection.Ping(readinessContext); err != nil {
				return err
			}
			if err := resyncRequestProjection.Ping(readinessContext); err != nil {
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
			for _, consumer := range projectionConsumers {
				if err := consumer.Ready(readinessContext); err != nil {
					return err
				}
			}
			return nil
		}
	}
	handler, err := httpadapter.NewHandler(serviceConfig.Name, managementService, readiness, authorizer)
	if err != nil {
		grpcServer.Stop()
		return err
	}
	httpErrors := make(chan error, 1)
	go func() {
		httpErrors <- httpx.Serve(
			contextValue,
			serviceConfig,
			logger,
			handler,
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
			return fmt.Errorf("shut down User authorization health server: %w", err)
		}
		return nil
	}
}

func grpcOptionsFor(runtime authzconfig.Runtime) ([]grpc.ServerOption, error) {
	if !runtime.RequireMTLS {
		return nil, nil
	}
	tlsConfig, err := config.LoadMTLSServerConfig(runtime.CertificateFile, runtime.KeyFile, runtime.ClientCAFile)
	if err != nil {
		return nil, fmt.Errorf("load authorization mTLS configuration: %w", err)
	}
	if tlsConfig.MinVersion != tls.VersionTLS13 {
		return nil, fmt.Errorf("authorization mTLS must require TLS 1.3")
	}
	return []grpc.ServerOption{
		grpc.Creds(credentials.NewTLS(tlsConfig)),
		grpc.UnaryInterceptor(grpcadapter.RequireCallerTargetSPIFFEIDs(runtime.TrustedServiceTargets)),
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
