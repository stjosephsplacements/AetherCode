package main

import (
	"context"
	"log/slog"
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
	"github.com/aethercode/aethercode/libs/pkg/telemetry"
	httpadapter "github.com/aethercode/aethercode/services/assessment/internal/adapters/http"
	"github.com/aethercode/aethercode/services/assessment/internal/adapters/projection"
	"github.com/aethercode/aethercode/services/assessment/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/assessment/internal/app"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx); err != nil {
		slog.Error("service stopped", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	serviceConfig, err := config.LoadService("assessment")
	if err != nil {
		return err
	}
	logger, err := logging.New(serviceConfig.LogLevel)
	if err != nil {
		return err
	}
	otelShutdown, err := telemetry.InitProvider(ctx, "assessment", "0.1.0")
	if err != nil {
		logger.Warn("telemetry provider init failed, tracing disabled", "error", err)
	} else {
		defer func() {
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			otelShutdown(shutdownCtx)
		}()
	}
	databaseConfig, err := config.LoadDatabase("ASSESSMENT")
	if err != nil {
		return err
	}
	pool, err := database.Open(ctx, databaseConfig)
	if err != nil {
		return err
	}
	defer pool.Close()

	authzRuntime, err := centralauthz.LoadClientRuntime(serviceConfig.Environment)
	if err != nil {
		return err
	}
	authzClient, connection, err := centralauthz.DialClient(ctx, authzRuntime)
	if err != nil {
		return err
	}
	defer func() { _ = connection.Close() }()
	authorizer, err := httpauth.New(authzClient, "assessment")
	if err != nil {
		return err
	}

	store, err := repo.NewPostgres(pool)
	if err != nil {
		return err
	}
	assessmentService, err := app.NewService(pool, store)
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
		publisher, publisherErr := messaging.NewPublisher(ctx, messagingRuntime.URL, serviceConfig.Name+"-outbox", outbox, logger)
		if publisherErr != nil {
			return publisherErr
		}
		go publisher.Run(ctx)

		projectionDatabaseConfig, projectionConfigErr := config.LoadDatabase("ASSESSMENT_PROJECTION")
		if projectionConfigErr != nil {
			return projectionConfigErr
		}
		projectionPool, projectionPoolErr := database.Open(ctx, projectionDatabaseConfig)
		if projectionPoolErr != nil {
			return projectionPoolErr
		}
		defer projectionPool.Close()
		snapshotProjection, snapshotProjectionErr := authzprojection.NewStore(projectionPool)
		if snapshotProjectionErr != nil {
			return snapshotProjectionErr
		}
		resyncProjection, resyncProjectionErr := authzprojection.NewResyncStore(projectionPool, "assessment")
		if resyncProjectionErr != nil {
			return resyncProjectionErr
		}
		snapshotConsumer, snapshotConsumerErr := messaging.NewPullConsumer(
			ctx, messagingRuntime.URL, serviceConfig.Name+"-authz-snapshot",
			"assessment_authz_snapshot_v1", authzprojection.SnapshotEventType, logger, snapshotProjection.Apply,
		)
		if snapshotConsumerErr != nil {
			return snapshotConsumerErr
		}
		resyncSnapshotSubject, resyncSubjectErr := authzprojection.ResyncSnapshotSubject("assessment")
		if resyncSubjectErr != nil {
			return resyncSubjectErr
		}
		resyncSnapshotConsumer, resyncSnapshotConsumerErr := messaging.NewPullConsumer(
			ctx, messagingRuntime.URL, serviceConfig.Name+"-authz-resync-snapshots",
			"assessment_authz_resync_snapshots_v1", resyncSnapshotSubject, logger, resyncProjection.ApplySnapshot,
		)
		if resyncSnapshotConsumerErr != nil {
			return resyncSnapshotConsumerErr
		}
		resyncCompletedSubject, resyncCompletedSubjectErr := authzprojection.ResyncCompletedSubject("assessment")
		if resyncCompletedSubjectErr != nil {
			return resyncCompletedSubjectErr
		}
		resyncCompletedConsumer, resyncCompletedConsumerErr := messaging.NewPullConsumer(
			ctx, messagingRuntime.URL, serviceConfig.Name+"-authz-resync-completed",
			"assessment_authz_resync_completed_v1", resyncCompletedSubject, logger, resyncProjection.ApplyCompleted,
		)
		if resyncCompletedConsumerErr != nil {
			return resyncCompletedConsumerErr
		}
		materializationStore, materializationStoreErr := projection.NewMaterializationStore(projectionPool)
		if materializationStoreErr != nil {
			return materializationStoreErr
		}
		enrolledConsumer, enrolledConsumerErr := messaging.NewPullConsumer(
			ctx, messagingRuntime.URL, serviceConfig.Name+"-student-enrolled",
			"assessment_student_enrolled_v1", projection.StudentEnrolledEventType, logger, materializationStore.ApplyStudentEnrolled,
		)
		if enrolledConsumerErr != nil {
			return enrolledConsumerErr
		}
		affiliationConsumer, affiliationConsumerErr := messaging.NewPullConsumer(
			ctx, messagingRuntime.URL, serviceConfig.Name+"-batch-affiliation",
			"assessment_batch_affiliation_v1", projection.StudentBatchAffiliationEventType, logger, materializationStore.ApplyBatchAffiliation,
		)
		if affiliationConsumerErr != nil {
			return affiliationConsumerErr
		}
		batchCreatedConsumer, batchCreatedErr := messaging.NewPullConsumer(
			ctx, messagingRuntime.URL, serviceConfig.Name+"-batch-created",
			"assessment_batch_created_v1", projection.BatchCreatedEventType, logger, materializationStore.ApplyBatchCreated,
		)
		if batchCreatedErr != nil {
			return batchCreatedErr
		}
		ruleCreatedConsumer, ruleCreatedErr := messaging.NewPullConsumer(
			ctx, messagingRuntime.URL, serviceConfig.Name+"-rule-created",
			"assessment_rule_created_v1", projection.AssignmentRuleCreatedEventType, logger, materializationStore.ApplyAssignmentRuleCreated,
		)
		if ruleCreatedErr != nil {
			return ruleCreatedErr
		}
		go snapshotConsumer.Run(ctx)
		go resyncSnapshotConsumer.Run(ctx)
		go resyncCompletedConsumer.Run(ctx)
		go enrolledConsumer.Run(ctx)
		go affiliationConsumer.Run(ctx)
		go batchCreatedConsumer.Run(ctx)
		go ruleCreatedConsumer.Run(ctx)
		resyncMonitor, resyncMonitorErr := authzprojection.NewResyncMonitor(
			resyncProjection, logger, publisher.Ready, snapshotConsumer.Ready,
			resyncSnapshotConsumer.Ready, resyncCompletedConsumer.Ready,
		)
		if resyncMonitorErr != nil {
			return resyncMonitorErr
		}
		go resyncMonitor.Run(ctx)
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
				enrolledConsumer, affiliationConsumer, batchCreatedConsumer, ruleCreatedConsumer,
			} {
				if err := consumer.Ready(readinessContext); err != nil {
					return err
				}
			}
			return nil
		}
	}

	handler, err := httpadapter.NewHandler(serviceConfig.Name, assessmentService, readiness, authorizer)
	if err != nil {
		return err
	}
	return httpx.Serve(ctx, serviceConfig, logger, telemetry.HTTPMiddleware("assessment", handler))
}
