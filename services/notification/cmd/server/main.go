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
	"github.com/aethercode/aethercode/libs/pkg/logging"
	"github.com/aethercode/aethercode/libs/pkg/messaging"
	"github.com/aethercode/aethercode/libs/pkg/telemetry"
	httpadapter "github.com/aethercode/aethercode/services/notification/internal/adapters/http"
	"github.com/aethercode/aethercode/services/notification/internal/adapters/projection"
	"github.com/aethercode/aethercode/services/notification/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/notification/internal/app"
	"github.com/aethercode/aethercode/services/notification/internal/retention"
	"github.com/aethercode/aethercode/services/notification/internal/worker"
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
	serviceConfig, err := config.LoadService("notification")
	if err != nil {
		return err
	}
	logger, err := logging.New(serviceConfig.LogLevel)
	if err != nil {
		return err
	}
	otelShutdown, err := telemetry.InitProvider(contextValue, "notification", "0.1.0")
	if err != nil {
		logger.Warn("telemetry provider init failed, tracing disabled", "error", err)
	} else {
		defer otelShutdown(contextValue)
	}
	databaseConfig, err := config.LoadDatabase("NOTIFICATION")
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
	authorizer, err := httpauth.New(authzClient, "notification")
	if err != nil {
		return err
	}
	store, err := repo.NewPostgres(pool)
	if err != nil {
		return err
	}
	notificationService, err := app.NewService(pool, store)
	if err != nil {
		return err
	}
	deliveryRunner, err := worker.NewInAppRunner(notificationService, logger)
	if err != nil {
		return err
	}
	go deliveryRunner.Run(contextValue)
	retentionRuntime, err := retention.LoadRuntime(serviceConfig.Environment)
	if err != nil {
		return err
	}
	var retentionRunner *retention.Runner
	if retentionRuntime.Enabled {
		retentionDatabaseConfig, retentionConfigErr := config.LoadDatabase("NOTIFICATION_RETENTION")
		if retentionConfigErr != nil {
			return retentionConfigErr
		}
		retentionPool, retentionPoolErr := database.Open(contextValue, retentionDatabaseConfig)
		if retentionPoolErr != nil {
			return retentionPoolErr
		}
		defer retentionPool.Close()
		retentionStore, retentionStoreErr := retention.NewStore(retentionPool)
		if retentionStoreErr != nil {
			return retentionStoreErr
		}
		if retentionRoleErr := retentionStore.Ping(contextValue); retentionRoleErr != nil {
			return retentionRoleErr
		}
		retentionRunner, retentionRunnerErr := retention.NewRunner(retentionStore, retentionRuntime, logger)
		if retentionRunnerErr != nil {
			return retentionRunnerErr
		}
		if retentionPurgeErr := retentionRunner.ProcessOnce(contextValue); retentionPurgeErr != nil {
			return fmt.Errorf("initial notification retention purge: %w", retentionPurgeErr)
		}
		go retentionRunner.Run(contextValue)
	}

	readiness := func(readinessContext context.Context) error {
		if err := store.Ping(readinessContext); err != nil {
			return err
		}
		if err := deliveryRunner.Ready(readinessContext); err != nil {
			return err
		}
		if retentionRunner != nil {
			return retentionRunner.Ready(readinessContext)
		}
		return nil
	}

	messagingRuntime, err := messaging.LoadRuntime(serviceConfig.Environment)
	if err != nil {
		return err
	}
	if messagingRuntime.URL != "" {
		outbox, err := messaging.NewOutboxStore(pool, "app.outbox_events")
		if err != nil {
			return err
		}
		publisher, err := messaging.NewPublisher(contextValue, messagingRuntime.URL, serviceConfig.Name+"-outbox", outbox, logger)
		if err != nil {
			return err
		}
		go publisher.Run(contextValue)

		projectionDatabaseConfig, err := config.LoadDatabase("NOTIFICATION_PROJECTION")
		if err != nil {
			return err
		}
		projectionPool, err := database.Open(contextValue, projectionDatabaseConfig)
		if err != nil {
			return err
		}
		defer projectionPool.Close()
		snapshotStore, err := authzprojection.NewStore(projectionPool)
		if err != nil {
			return err
		}
		resyncProjection, err := authzprojection.NewResyncStore(projectionPool, "notification")
		if err != nil {
			return err
		}
		tenantProjection, err := projection.NewStore(projectionPool)
		if err != nil {
			return err
		}
		resyncSnapshotSubject, err := authzprojection.ResyncSnapshotSubject("notification")
		if err != nil {
			return err
		}
		resyncSnapshotConsumer, err := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-authz-resync-snapshots",
			"notification_authz_resync_snapshots_v1", resyncSnapshotSubject, logger, resyncProjection.ApplySnapshot,
		)
		if err != nil {
			return err
		}
		resyncCompletedSubject, err := authzprojection.ResyncCompletedSubject("notification")
		if err != nil {
			return err
		}
		resyncCompletedConsumer, err := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-authz-resync-completed",
			"notification_authz_resync_completed_v1", resyncCompletedSubject, logger, resyncProjection.ApplyCompleted,
		)
		if err != nil {
			return err
		}
		snapshotConsumer, err := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-authz-snapshot",
			"notification_authz_snapshot_v1", authzprojection.SnapshotEventType, logger, snapshotStore.Apply,
		)
		if err != nil {
			return err
		}
		retentionConsumer, err := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-tenant-retention",
			"notification_tenant_retention_v2", projection.RetentionPolicyEvent, logger, tenantProjection.ApplyRetentionPolicy,
		)
		if err != nil {
			return err
		}
		holdPlacedConsumer, err := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-tenant-hold-placed",
			"notification_tenant_hold_placed_v2", projection.LegalHoldPlacedEvent, logger, tenantProjection.ApplyLegalHoldPlaced,
		)
		if err != nil {
			return err
		}
		holdReleasedConsumer, err := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-tenant-hold-released",
			"notification_tenant_hold_released_v2", projection.LegalHoldReleasedEvent, logger, tenantProjection.ApplyLegalHoldReleased,
		)
		if err != nil {
			return err
		}
		go snapshotConsumer.Run(contextValue)
		go resyncSnapshotConsumer.Run(contextValue)
		go resyncCompletedConsumer.Run(contextValue)
		go retentionConsumer.Run(contextValue)
		go holdPlacedConsumer.Run(contextValue)
		go holdReleasedConsumer.Run(contextValue)
		resyncMonitor, err := authzprojection.NewResyncMonitor(
			resyncProjection, logger, publisher.Ready, snapshotConsumer.Ready,
			resyncSnapshotConsumer.Ready, resyncCompletedConsumer.Ready,
		)
		if err != nil {
			return err
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
			if err := snapshotStore.Ping(readinessContext); err != nil {
				return err
			}
			if err := resyncProjection.Ping(readinessContext); err != nil {
				return err
			}
			if err := resyncProjection.Ready(readinessContext); err != nil {
				return err
			}
			if err := tenantProjection.Ping(readinessContext); err != nil {
				return err
			}
			for _, consumer := range []*messaging.PullConsumer{
				snapshotConsumer, resyncSnapshotConsumer, resyncCompletedConsumer,
				retentionConsumer, holdPlacedConsumer, holdReleasedConsumer,
			} {
				if err := consumer.Ready(readinessContext); err != nil {
					return err
				}
			}
			return nil
		}
	}

	handler, err := httpadapter.NewHandler(serviceConfig.Name, notificationService, readiness, authorizer)
	if err != nil {
		return err
	}
	return httpx.Serve(contextValue, serviceConfig, logger, telemetry.HTTPMiddleware("notification", handler))
}
