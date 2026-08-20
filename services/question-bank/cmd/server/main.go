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
	httpadapter "github.com/aethercode/aethercode/services/question-bank/internal/adapters/http"
	"github.com/aethercode/aethercode/services/question-bank/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/question-bank/internal/app"
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
	defer connection.Close()
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

	questionBank, err := app.NewService(pool, store)
	if err != nil {
		return err
	}
	handler, err := httpadapter.NewHandler(serviceConfig.Name, questionBank, readiness, authorizer)
	if err != nil {
		return err
	}
	return httpx.Serve(contextValue, serviceConfig, logger, handler)
}
