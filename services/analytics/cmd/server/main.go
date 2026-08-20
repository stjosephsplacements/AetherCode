package main

import (
	"context"
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
	httpadapter "github.com/aethercode/aethercode/services/analytics/internal/adapters/http"
	"github.com/aethercode/aethercode/services/analytics/internal/adapters/projection"
	"github.com/aethercode/aethercode/services/analytics/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/analytics/internal/app"
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
	serviceConfig, err := config.LoadService("analytics")
	if err != nil {
		return err
	}
	logger, err := logging.New(serviceConfig.LogLevel)
	if err != nil {
		return err
	}
	databaseConfig, err := config.LoadDatabase("ANALYTICS")
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
	defer connection.Close()
	authorizer, err := httpauth.New(authzClient, "analytics")
	if err != nil {
		return err
	}
	reportStore, err := repo.NewPostgres(pool)
	if err != nil {
		return err
	}
	analyticsORM, err := database.OpenORM(pool)
	if err != nil {
		return err
	}
	defer analyticsORM.Close()
	analyticsService, err := app.NewService(pool, analyticsORM, reportStore)
	if err != nil {
		return err
	}
	readiness := func(readinessContext context.Context) error {
		if err := reportStore.Ping(readinessContext); err != nil {
			return err
		}
		return analyticsORM.Ping(readinessContext)
	}
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

		projectionDatabaseConfig, projectionConfigErr := config.LoadDatabase("ANALYTICS_PROJECTION")
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
		resyncProjection, resyncProjectionErr := authzprojection.NewResyncStore(projectionPool, "analytics")
		if resyncProjectionErr != nil {
			return resyncProjectionErr
		}
		reportProjection, reportProjectionErr := projection.NewStore(projectionPool)
		if reportProjectionErr != nil {
			return reportProjectionErr
		}
		snapshotConsumer, snapshotConsumerErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-authz-snapshot",
			"analytics_authz_snapshot_v1", authzprojection.SnapshotEventType, logger, snapshotProjection.Apply,
		)
		if snapshotConsumerErr != nil {
			return snapshotConsumerErr
		}
		resyncSnapshotSubject, resyncSubjectErr := authzprojection.ResyncSnapshotSubject("analytics")
		if resyncSubjectErr != nil {
			return resyncSubjectErr
		}
		resyncSnapshotConsumer, resyncSnapshotConsumerErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-authz-resync-snapshots",
			"analytics_authz_resync_snapshots_v1", resyncSnapshotSubject, logger, resyncProjection.ApplySnapshot,
		)
		if resyncSnapshotConsumerErr != nil {
			return resyncSnapshotConsumerErr
		}
		resyncCompletedSubject, resyncCompletedSubjectErr := authzprojection.ResyncCompletedSubject("analytics")
		if resyncCompletedSubjectErr != nil {
			return resyncCompletedSubjectErr
		}
		resyncCompletedConsumer, resyncCompletedConsumerErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-authz-resync-completed",
			"analytics_authz_resync_completed_v1", resyncCompletedSubject, logger, resyncProjection.ApplyCompleted,
		)
		if resyncCompletedConsumerErr != nil {
			return resyncCompletedConsumerErr
		}
		consumers := []*messaging.PullConsumer{snapshotConsumer, resyncSnapshotConsumer, resyncCompletedConsumer}
		for _, specification := range []struct {
			durable string
			subject string
			handler messaging.EventHandler
		}{
			{"analytics_student_enrolled_v1", projection.StudentEnrolledEventType, reportProjection.ApplyStudentEnrolled},
			{"analytics_student_batch_affiliation_snapshot_v1", projection.StudentBatchAffiliationEventType, reportProjection.ApplyStudentBatchAffiliationSnapshot},
			{"analytics_exam_item_created_v1", projection.ExamItemCreatedEventType, reportProjection.ApplyExamItemCreated},
			{"analytics_assignment_snapshot_v1", projection.AssignmentSnapshotEventType, reportProjection.ApplyAssignmentSnapshot},
			{"analytics_evaluation_requested_v1", projection.EvaluationRequestedEventType, reportProjection.ApplyEvaluationRequested},
			{"analytics_judge_completed_v1", projection.JudgeCompletedEventType, reportProjection.ApplyJudgeCompleted},
			{"analytics_attempt_started_v1", projection.AttemptStartedEventType, reportProjection.ApplyAttemptStarted},
			{"analytics_attempt_submitted_v1", projection.AttemptSubmittedEventType, reportProjection.ApplyAttemptSubmitted},
			{"analytics_attempt_graded_v1", projection.AttemptGradedEventType, reportProjection.ApplyAttemptGraded},
			{"analytics_attempt_cancelled_v1", projection.AttemptCancelledEventType, reportProjection.ApplyAttemptCancelled},
			{"analytics_legal_hold_placed_v1", projection.LegalHoldPlacedEventType, reportProjection.ApplyLegalHoldPlaced},
			{"analytics_legal_hold_released_v1", projection.LegalHoldReleasedEventType, reportProjection.ApplyLegalHoldReleased},
			{"analytics_retention_policy_updated_v1", projection.RetentionPolicyUpdatedEventType, reportProjection.ApplyRetentionPolicyUpdated},
		} {
			consumer, consumerErr := messaging.NewPullConsumer(
				contextValue, messagingRuntime.URL, serviceConfig.Name+"-"+specification.durable,
				specification.durable, specification.subject, logger, specification.handler,
			)
			if consumerErr != nil {
				return consumerErr
			}
			consumers = append(consumers, consumer)
		}
		for _, consumer := range consumers {
			go consumer.Run(contextValue)
		}
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
			if err := reportProjection.Ping(readinessContext); err != nil {
				return err
			}
			for _, consumer := range consumers {
				if err := consumer.Ready(readinessContext); err != nil {
					return err
				}
			}
			return nil
		}
	}
	handler, err := httpadapter.NewHandler(serviceConfig.Name, analyticsService, readiness, authorizer)
	if err != nil {
		return err
	}
	return httpx.Serve(contextValue, serviceConfig, logger, handler)
}
