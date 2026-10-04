package main

import (
	"context"
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
	"github.com/aethercode/aethercode/libs/pkg/grpcmtls"
	"github.com/aethercode/aethercode/libs/pkg/httpauth"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
	localkms "github.com/aethercode/aethercode/libs/pkg/kms/local"
	"github.com/aethercode/aethercode/libs/pkg/logging"
	"github.com/aethercode/aethercode/libs/pkg/messaging"
	minioclient "github.com/aethercode/aethercode/libs/pkg/storage/minio"
	"github.com/aethercode/aethercode/libs/pkg/telemetry"
	questionbankv1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/questionbank/v1"
	grpcadapter "github.com/aethercode/aethercode/services/question-bank/internal/adapters/grpc"
	httpadapter "github.com/aethercode/aethercode/services/question-bank/internal/adapters/http"
	"github.com/aethercode/aethercode/services/question-bank/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/question-bank/internal/app"
	qbankconfig "github.com/aethercode/aethercode/services/question-bank/internal/config"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
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
	serviceConfig, err := config.LoadService("question-bank")
	if err != nil {
		return err
	}
	logger, err := logging.New(serviceConfig.LogLevel)
	if err != nil {
		return err
	}
	otelShutdown, err := telemetry.InitProvider(contextValue, "question-bank", "0.1.0")
	if err != nil {
		logger.Warn("telemetry provider init failed, tracing disabled", "error", err)
	} else {
		defer func() {
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			otelShutdown(shutdownCtx)
		}()
	}
	databaseConfig, err := config.LoadDatabase("QBANK")
	if err != nil {
		return err
	}
	pool, err := database.Open(contextValue, databaseConfig)
	if err != nil {
		return err
	}
	defer pool.Close()

	authzRuntime, err := centralauthz.LoadClientRuntime(serviceConfig.Environment)
	if err != nil {
		return err
	}
	authzClient, connection, err := centralauthz.DialClient(contextValue, authzRuntime)
	if err != nil {
		return err
	}
	defer func() { _ = connection.Close() }()
	authorizer, err := httpauth.New(authzClient, "question-bank")
	if err != nil {
		return err
	}

	store, err := repo.NewPostgres(pool)
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
		publisher, publisherErr := messaging.NewPublisher(contextValue, messagingRuntime.URL, serviceConfig.Name+"-outbox", outbox, logger)
		if publisherErr != nil {
			return publisherErr
		}
		go publisher.Run(contextValue)

		projectionDatabaseConfig, projectionConfigErr := config.LoadDatabase("QBANK_PROJECTION")
		if projectionConfigErr != nil {
			return projectionConfigErr
		}
		projectionPool, projectionPoolErr := database.Open(contextValue, projectionDatabaseConfig)
		if projectionPoolErr != nil {
			return projectionPoolErr
		}
		defer projectionPool.Close()
		snapshotProjection, snapshotProjectionErr := authzprojection.NewStore(projectionPool)
		if snapshotProjectionErr != nil {
			return snapshotProjectionErr
		}
		resyncProjection, resyncProjectionErr := authzprojection.NewResyncStore(projectionPool, "question-bank")
		if resyncProjectionErr != nil {
			return resyncProjectionErr
		}
		snapshotConsumer, consumerErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-authz-snapshot",
			"question_bank_authz_snapshot_v1", authzprojection.SnapshotEventType, logger, snapshotProjection.Apply,
		)
		if consumerErr != nil {
			return consumerErr
		}
		resyncSnapshotSubject, resyncSubjectErr := authzprojection.ResyncSnapshotSubject("question-bank")
		if resyncSubjectErr != nil {
			return resyncSubjectErr
		}
		resyncSnapshotConsumer, resyncSnapshotConsumerErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-authz-resync-snapshots",
			"question_bank_authz_resync_snapshots_v1", resyncSnapshotSubject, logger, resyncProjection.ApplySnapshot,
		)
		if resyncSnapshotConsumerErr != nil {
			return resyncSnapshotConsumerErr
		}
		resyncCompletedSubject, resyncCompletedSubjectErr := authzprojection.ResyncCompletedSubject("question-bank")
		if resyncCompletedSubjectErr != nil {
			return resyncCompletedSubjectErr
		}
		resyncCompletedConsumer, resyncCompletedConsumerErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-authz-resync-completed",
			"question_bank_authz_resync_completed_v1", resyncCompletedSubject, logger, resyncProjection.ApplyCompleted,
		)
		if resyncCompletedConsumerErr != nil {
			return resyncCompletedConsumerErr
		}
		go snapshotConsumer.Run(contextValue)
		go resyncSnapshotConsumer.Run(contextValue)
		go resyncCompletedConsumer.Run(contextValue)
		resyncMonitor, resyncMonitorErr := authzprojection.NewResyncMonitor(
			resyncProjection, logger, publisher.Ready, snapshotConsumer.Ready,
			resyncSnapshotConsumer.Ready, resyncCompletedConsumer.Ready,
		)
		if resyncMonitorErr != nil {
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

	// Storage and KMS are required: Question Bank encrypts and stores test
	// bundles itself, so a missing variable must stop startup, not 503 later.
	storageCfg, err := minioclient.LoadConfig("QBANK_STORAGE")
	if err != nil {
		return err
	}
	storageClient, err := minioclient.New(storageCfg)
	if err != nil {
		return err
	}
	kmsCfg, err := localkms.LoadConfig("QBANK")
	if err != nil {
		return err
	}
	kmsClient := localkms.New(kmsCfg)

	questionBank, err := app.NewService(pool, store, storageClient, kmsClient, logger)
	if err != nil {
		return err
	}
	handler, err := httpadapter.NewHandler(serviceConfig.Name, questionBank, readiness, authorizer)
	if err != nil {
		return err
	}

	// QuestionBankInternalService: Assessment resolves published versions here.
	grpcRuntime, err := qbankconfig.LoadGRPC(serviceConfig.Environment)
	if err != nil {
		return err
	}
	resolver, err := app.NewResolver(store)
	if err != nil {
		return err
	}
	grpcServer, err := newInternalServer(grpcRuntime, resolver)
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", grpcRuntime.Address)
	if err != nil {
		return fmt.Errorf("listen for Question Bank gRPC: %w", err)
	}
	grpcErrors := make(chan error, 1)
	go func() {
		logger.Info("Question Bank gRPC listening", "address", grpcRuntime.Address, "mtls", grpcRuntime.RequireMTLS)
		grpcErrors <- grpcServer.Serve(listener)
	}()
	httpErrors := make(chan error, 1)
	go func() {
		httpErrors <- httpx.Serve(contextValue, serviceConfig, logger, telemetry.HTTPMiddleware("question-bank", handler))
	}()
	select {
	case err := <-grpcErrors:
		return fmt.Errorf("serve Question Bank gRPC: %w", err)
	case err := <-httpErrors:
		grpcServer.GracefulStop()
		return err
	}
}

func newInternalServer(runtime qbankconfig.GRPC, resolver *app.Resolver) (*grpc.Server, error) {
	var options []grpc.ServerOption
	if runtime.RequireMTLS {
		tlsConfig, err := config.LoadMTLSServerConfig(runtime.CertificateFile, runtime.KeyFile, runtime.ClientCAFile)
		if err != nil {
			return nil, fmt.Errorf("load Question Bank gRPC mTLS configuration: %w", err)
		}
		options = append(options,
			grpc.Creds(credentials.NewTLS(tlsConfig)),
			grpc.UnaryInterceptor(grpcmtls.RequireClientSubjects("Question Bank", runtime.AllowedSubjects)),
		)
	}
	server := grpc.NewServer(options...)
	questionbankv1.RegisterQuestionBankInternalServiceServer(server, grpcadapter.NewServer(resolver))
	return server, nil
}
