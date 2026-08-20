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
	httpadapter "github.com/aethercode/aethercode/services/submission/internal/adapters/http"
	"github.com/aethercode/aethercode/services/submission/internal/adapters/judgecompletion"
	"github.com/aethercode/aethercode/services/submission/internal/adapters/projection"
	"github.com/aethercode/aethercode/services/submission/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/submission/internal/app"
	"github.com/aethercode/aethercode/services/submission/internal/expiry"
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
	serviceConfig, err := config.LoadService("submission")
	if err != nil {
		return err
	}
	logger, err := logging.New(serviceConfig.LogLevel)
	if err != nil {
		return err
	}
	otelShutdown, err := telemetry.InitProvider(contextValue, "submission", "0.1.0")
	if err != nil {
		logger.Warn("telemetry provider init failed, tracing disabled", "error", err)
	} else {
		defer otelShutdown(contextValue)
	}
	databaseConfig, err := config.LoadDatabase("SUBMISSION")
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
	authorizer, err := httpauth.New(authzClient, "submission")
	if err != nil {
		return err
	}

	store, err := repo.NewPostgres(pool)
	if err != nil {
		return err
	}
	submissionService, err := app.NewService(pool, store)
	if err != nil {
		return err
	}
	readiness := store.Ping
	judgeCompletionRuntime, err := judgecompletion.LoadRuntime(serviceConfig.Environment)
	if err != nil {
		return err
	}
	var judgeCompletionWorker *judgecompletion.Worker

	messagingRuntime, err := messaging.LoadRuntime(serviceConfig.Environment)
	if err != nil {
		return err
	}
	if judgeCompletionRuntime.Enabled && messagingRuntime.URL == "" {
		return fmt.Errorf("NATS_URL is required when the Judge completion bridge is enabled")
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

		if judgeCompletionRuntime.Enabled {
			adapterDatabaseConfig, adapterConfigErr := config.LoadDatabase("SUBMISSION_JUDGE_ADAPTER")
			if adapterConfigErr != nil {
				return adapterConfigErr
			}
			adapterPool, adapterPoolErr := database.Open(contextValue, adapterDatabaseConfig)
			if adapterPoolErr != nil {
				return adapterPoolErr
			}
			defer adapterPool.Close()
			adapterStore, adapterStoreErr := judgecompletion.NewStore(adapterPool)
			if adapterStoreErr != nil {
				return adapterStoreErr
			}
			judgeClient, judgeClientErr := judgecompletion.Dial(contextValue, judgeCompletionRuntime)
			if judgeClientErr != nil {
				return judgeClientErr
			}
			defer func() { _ = judgeClient.Close() }()
			judgeCompletionWorker, judgeWorkerErr := judgecompletion.NewWorker(
				judgeClient, adapterStore, judgeCompletionRuntime, logger,
			)
			if judgeWorkerErr != nil {
				return judgeWorkerErr
			}
			if judgePullErr := judgeCompletionWorker.ProcessOnce(contextValue); judgePullErr != nil {
				return fmt.Errorf("initial Judge completion pull: %w", judgePullErr)
			}
			go judgeCompletionWorker.Run(contextValue)
		}

		projectionDatabaseConfig, projectionConfigErr := config.LoadDatabase("SUBMISSION_PROJECTION")
		if projectionConfigErr != nil {
			return projectionConfigErr
		}
		projectionPool, projectionPoolErr := database.Open(contextValue, projectionDatabaseConfig)
		if projectionPoolErr != nil {
			return projectionPoolErr
		}
		defer projectionPool.Close()

		authzSnapshotStore, snapshotStoreErr := authzprojection.NewStore(projectionPool)
		if snapshotStoreErr != nil {
			return snapshotStoreErr
		}
		resyncProjection, resyncProjectionErr := authzprojection.NewResyncStore(projectionPool, "submission")
		if resyncProjectionErr != nil {
			return resyncProjectionErr
		}
		projectionStore, projectionStoreErr := projection.NewStore(projectionPool)
		if projectionStoreErr != nil {
			return projectionStoreErr
		}
		authzSnapshotConsumer, consumerErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-authz-snapshot",
			"submission_authz_snapshot_v1", authzprojection.SnapshotEventType, logger, authzSnapshotStore.Apply,
		)
		if consumerErr != nil {
			return consumerErr
		}
		resyncSnapshotSubject, resyncSubjectErr := authzprojection.ResyncSnapshotSubject("submission")
		if resyncSubjectErr != nil {
			return resyncSubjectErr
		}
		resyncSnapshotConsumer, resyncSnapshotConsumerErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-authz-resync-snapshots",
			"submission_authz_resync_snapshots_v1", resyncSnapshotSubject, logger, resyncProjection.ApplySnapshot,
		)
		if resyncSnapshotConsumerErr != nil {
			return resyncSnapshotConsumerErr
		}
		resyncCompletedSubject, resyncCompletedSubjectErr := authzprojection.ResyncCompletedSubject("submission")
		if resyncCompletedSubjectErr != nil {
			return resyncCompletedSubjectErr
		}
		resyncCompletedConsumer, resyncCompletedConsumerErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-authz-resync-completed",
			"submission_authz_resync_completed_v1", resyncCompletedSubject, logger, resyncProjection.ApplyCompleted,
		)
		if resyncCompletedConsumerErr != nil {
			return resyncCompletedConsumerErr
		}
		assignmentConsumer, consumerErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-assignment-snapshot",
			"submission_assignment_snapshot_v1", projection.AssignmentSnapshotEventType, logger, projectionStore.ApplyAssignmentSnapshot,
		)
		if consumerErr != nil {
			return consumerErr
		}
		judgeCompletionConsumer, consumerErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-judge-completion",
			"submission_judge_completed_v1", projection.JudgeCompletedEventType, logger, projectionStore.ApplyJudgeCompletion,
		)
		if consumerErr != nil {
			return consumerErr
		}
		go authzSnapshotConsumer.Run(contextValue)
		go resyncSnapshotConsumer.Run(contextValue)
		go resyncCompletedConsumer.Run(contextValue)
		go assignmentConsumer.Run(contextValue)
		go judgeCompletionConsumer.Run(contextValue)
		resyncMonitor, resyncMonitorErr := authzprojection.NewResyncMonitor(
			resyncProjection, logger, publisher.Ready, authzSnapshotConsumer.Ready,
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
			if err := authzSnapshotStore.Ping(readinessContext); err != nil {
				return err
			}
			if err := resyncProjection.Ping(readinessContext); err != nil {
				return err
			}
			if err := resyncProjection.Ready(readinessContext); err != nil {
				return err
			}
			if err := projectionStore.Ping(readinessContext); err != nil {
				return err
			}
			if judgeCompletionWorker != nil {
				if err := judgeCompletionWorker.Ready(readinessContext); err != nil {
					return err
				}
			}
			if err := authzSnapshotConsumer.Ready(readinessContext); err != nil {
				return err
			}
			if err := resyncSnapshotConsumer.Ready(readinessContext); err != nil {
				return err
			}
			if err := resyncCompletedConsumer.Ready(readinessContext); err != nil {
				return err
			}
			if err := assignmentConsumer.Ready(readinessContext); err != nil {
				return err
			}
			return judgeCompletionConsumer.Ready(readinessContext)
		}
	}

	expiryRuntime, err := expiry.LoadRuntime(serviceConfig.Environment)
	if err != nil {
		return err
	}
	var expiryRunner *expiry.Runner
	if expiryRuntime.Enabled {
		expiryDatabaseConfig, expiryConfigErr := config.LoadDatabase("SUBMISSION_EXPIRY")
		if expiryConfigErr != nil {
			return expiryConfigErr
		}
		expiryPool, expiryPoolErr := database.Open(contextValue, expiryDatabaseConfig)
		if expiryPoolErr != nil {
			return expiryPoolErr
		}
		defer expiryPool.Close()
		expiryStore, expiryStoreErr := expiry.NewStore(expiryPool)
		if expiryStoreErr != nil {
			return expiryStoreErr
		}
		if expiryRoleErr := expiryStore.Ping(contextValue); expiryRoleErr != nil {
			return expiryRoleErr
		}
		var expiryRunnerErr error
		expiryRunner, expiryRunnerErr = expiry.NewRunner(expiryStore, expiryRuntime, logger)
		if expiryRunnerErr != nil {
			return expiryRunnerErr
		}
		if expiryOnceErr := expiryRunner.ProcessOnce(contextValue); expiryOnceErr != nil {
			return fmt.Errorf("initial attempt expiry cycle: %w", expiryOnceErr)
		}
		go expiryRunner.Run(contextValue)
	}

	priorReadiness := readiness
	readiness = func(readinessContext context.Context) error {
		if err := priorReadiness(readinessContext); err != nil {
			return err
		}
		if expiryRunner != nil {
			return expiryRunner.Ready(readinessContext)
		}
		return nil
	}

	handler, err := httpadapter.NewHandler(serviceConfig.Name, submissionService, readiness, authorizer)
	if err != nil {
		return err
	}
	return httpx.Serve(contextValue, serviceConfig, logger, telemetry.HTTPMiddleware("submission", handler))
}
