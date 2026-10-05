package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

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
	"github.com/aethercode/aethercode/libs/pkg/telemetry"
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
	otelShutdown, err := telemetry.InitProvider(contextValue, "seb", "0.1.0")
	if err != nil {
		logger.Warn("telemetry provider init failed, tracing disabled", "error", err)
	} else {
		defer func() {
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			otelShutdown(shutdownCtx)
		}()
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
			"seb_attempt_submitted_v2", projection.AttemptSubmittedEventType, logger, lifecycleStore.ApplyAttemptSubmitted,
		)
		if attemptSubmittedErr != nil {
			return attemptSubmittedErr
		}
		// The v2 durables replay the stream from the start: the v1 durables
		// rejected every real event (strict decoding), so nothing was applied.
		assignmentSnapshotConsumer, assignmentSnapshotErr := messaging.NewPullConsumer(
			contextValue, messagingRuntime.URL, serviceConfig.Name+"-assignment-snapshot",
			"seb_assignment_snapshot_v2", projection.AssignmentSnapshotEventType, logger, lifecycleStore.ApplyAssignmentSnapshot,
		)
		if assignmentSnapshotErr != nil {
			return assignmentSnapshotErr
		}
		go snapshotConsumer.Run(contextValue)
		go resyncSnapshotConsumer.Run(contextValue)
		go resyncCompletionConsumer.Run(contextValue)
		go attemptSubmittedConsumer.Run(contextValue)
		go assignmentSnapshotConsumer.Run(contextValue)
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
			return assignmentSnapshotConsumer.Ready(readinessContext)
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

	launch, err := loadLaunchSettings()
	if err != nil {
		return err
	}
	sebService, err := app.NewService(pool, store, store, storageClient, kmsClient, launch)
	if err != nil {
		return err
	}
	handler, err := httpadapter.NewHandler(serviceConfig.Name, sebService, readiness, authorizer)
	if err != nil {
		return err
	}
	return httpx.Serve(contextValue, serviceConfig, logger, telemetry.HTTPMiddleware("seb", handler))
}

// loadLaunchSettings reads the .seb file settings. Both variables are set or
// neither is; without them the launch-file routes return 503.
func loadLaunchSettings() (app.LaunchSettings, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(os.Getenv("SEB_LAUNCH_BASE_URL")), "/")
	password := os.Getenv("SEB_LAUNCH_PASSWORD")
	if baseURL == "" && password == "" {
		return app.LaunchSettings{}, nil
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" ||
		(parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.Fragment != "" {
		return app.LaunchSettings{}, fmt.Errorf("SEB_LAUNCH_BASE_URL must be the web app's origin, such as https://exam.example.edu")
	}
	if len(password) < 16 {
		return app.LaunchSettings{}, fmt.Errorf("SEB_LAUNCH_PASSWORD must be set with SEB_LAUNCH_BASE_URL and be at least 16 characters")
	}
	return app.LaunchSettings{BaseURL: baseURL, Password: password}, nil
}
