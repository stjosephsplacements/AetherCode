package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/authzprojection"
	"github.com/aethercode/aethercode/libs/pkg/config"
	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/aethercode/aethercode/libs/pkg/httpauth"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/libs/pkg/kms"
	localkms "github.com/aethercode/aethercode/libs/pkg/kms/local"
	"github.com/aethercode/aethercode/libs/pkg/logging"
	"github.com/aethercode/aethercode/libs/pkg/messaging"
	"github.com/aethercode/aethercode/libs/pkg/storage"
	minioclient "github.com/aethercode/aethercode/libs/pkg/storage/minio"
	httpadapter "github.com/aethercode/aethercode/services/seb/internal/adapters/http"
	"github.com/aethercode/aethercode/services/seb/internal/adapters/projection"
	"github.com/aethercode/aethercode/services/seb/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/seb/internal/app"
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
	serviceConfig, err := config.LoadService("seb")
	if err != nil {
		return err
	}
	logger, err := logging.New(serviceConfig.LogLevel)
	if err != nil {
		return err
	}
	databaseConfig, err := config.LoadDatabase("SEB")
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
	authorizer, err := httpauth.New(authzClient, "seb")
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
	if messagingRuntime.URL == "" {
		return fmt.Errorf("NATS_URL is required for the SEB authorization projection resync gate")
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
		projectionDatabaseConfig, projectionConfigErr := config.LoadDatabase("SEB_PROJECTION")
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
		resyncProjection, resyncProjectionErr := authzprojection.NewResyncStore(projectionPool, "seb")
		if resyncProjectionErr != nil {
			return resyncProjectionErr
		}
		snapshotConsumer, snapshotConsumerErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-authz-snapshot",
			"seb_authz_snapshot_v1", authzprojection.SnapshotEventType, logger, snapshotProjection.Apply,
		)
		if snapshotConsumerErr != nil {
			return snapshotConsumerErr
		}
		resyncSnapshotSubject, resyncSubjectErr := authzprojection.ResyncSnapshotSubject("seb")
		if resyncSubjectErr != nil {
			return resyncSubjectErr
		}
		resyncSnapshotConsumer, resyncSnapshotConsumerErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-authz-resync-snapshots",
			"seb_authz_resync_snapshots_v1", resyncSnapshotSubject, logger, resyncProjection.ApplySnapshot,
		)
		if resyncSnapshotConsumerErr != nil {
			return resyncSnapshotConsumerErr
		}
		resyncCompletionSubject, resyncCompletionSubjectErr := authzprojection.ResyncCompletedSubject("seb")
		if resyncCompletionSubjectErr != nil {
			return resyncCompletionSubjectErr
		}
		resyncCompletionConsumer, resyncCompletionConsumerErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-authz-resync-completed",
			"seb_authz_resync_completed_v1", resyncCompletionSubject, logger, resyncProjection.ApplyCompleted,
		)
		if resyncCompletionConsumerErr != nil {
			return resyncCompletionConsumerErr
		}
		lifecycleStore, lifecycleStoreErr := projection.NewLifecycleStore(projectionPool)
		if lifecycleStoreErr != nil {
			return lifecycleStoreErr
		}
		attemptSubmittedConsumer, attemptSubmittedErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-attempt-submitted",
			"seb_attempt_submitted_v1", projection.AttemptSubmittedEventType, logger, lifecycleStore.ApplyAttemptSubmitted,
		)
		if attemptSubmittedErr != nil {
			return attemptSubmittedErr
		}
		assignmentRevokedConsumer, assignmentRevokedErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-assignment-revoked",
			"seb_assignment_revoked_v1", projection.AssignmentRevokedEventType, logger, lifecycleStore.ApplyAssignmentRevoked,
		)
		if assignmentRevokedErr != nil {
			return assignmentRevokedErr
		}
		go snapshotConsumer.Run(contextValue)
		go resyncSnapshotConsumer.Run(contextValue)
		go resyncCompletionConsumer.Run(contextValue)
		go attemptSubmittedConsumer.Run(contextValue)
		go assignmentRevokedConsumer.Run(contextValue)
		resyncMonitor, resyncMonitorErr := authzprojection.NewResyncMonitor(
			resyncProjection,
			logger,
			publisher.Ready,
			snapshotConsumer.Ready,
			resyncSnapshotConsumer.Ready,
			resyncCompletionConsumer.Ready,
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
			if err := snapshotConsumer.Ready(readinessContext); err != nil {
				return err
			}
			if err := resyncSnapshotConsumer.Ready(readinessContext); err != nil {
				return err
			}
			if err := resyncCompletionConsumer.Ready(readinessContext); err != nil {
				return err
			}
			if err := attemptSubmittedConsumer.Ready(readinessContext); err != nil {
				return err
			}
			return assignmentRevokedConsumer.Ready(readinessContext)
		}
	}
	// NOTE: Storage and KMS are optional. Set SEB_STORAGE_ENDPOINT and
	// SEB_KMS_LOCAL_KEY to enable the configuration payload endpoint. It
	// returns 503 Unavailable when these variables are absent.
	var storageClient storage.Object
	var kmsClient kms.KeyManager
	if os.Getenv("SEB_STORAGE_ENDPOINT") != "" {
		storageCfg, storageErr := minioclient.LoadConfig("SEB_STORAGE")
		if storageErr != nil {
			return storageErr
		}
		storageClient, storageErr = minioclient.New(storageCfg)
		if storageErr != nil {
			return storageErr
		}
	}
	if os.Getenv("SEB_KMS_LOCAL_KEY") != "" {
		kmsCfg, kmsErr := localkms.LoadConfig("SEB")
		if kmsErr != nil {
			return kmsErr
		}
		kmsClient = localkms.New(kmsCfg)
	}

	sebService, err := app.NewService(pool, store, storageClient, kmsClient)
	if err != nil {
		return err
	}
	handler, err := httpadapter.NewHandler(serviceConfig.Name, sebService, readiness, authorizer)
	if err != nil {
		return err
	}
	return httpx.Serve(contextValue, serviceConfig, logger, handler)
}
