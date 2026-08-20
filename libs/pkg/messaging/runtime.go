package messaging

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync/atomic"
	"time"

	"github.com/nats-io/nats.go"
)

const platformStream = "AETHERCODE_EVENTS"

// Runtime holds the broker setting shared by platform services. Production
// deployments may not silently disable durable event publication.
type Runtime struct {
	URL string
}

func LoadRuntime(environment string) (Runtime, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	url := strings.TrimSpace(os.Getenv("NATS_URL"))
	if url == "" && (environment == "staging" || environment == "production") {
		return Runtime{}, fmt.Errorf("NATS_URL is required in %s", environment)
	}
	if url != "" && !strings.HasPrefix(url, "nats://") && !strings.HasPrefix(url, "tls://") {
		return Runtime{}, fmt.Errorf("NATS_URL must use nats:// or tls://")
	}
	return Runtime{URL: url}, nil
}

// Publisher continuously drains a service-local outbox to the platform
// JetStream stream. A database lease plus Nats-Msg-Id makes failover and retry
// safe: duplicate publication is harmless and a crashed publisher's lease
// expires for another replica.
type Publisher struct {
	store       *OutboxStore
	connection  *nats.Conn
	stream      nats.JetStreamContext
	logger      *slog.Logger
	batchSize   int
	lease       time.Duration
	interval    time.Duration
	lastFailure atomic.Value
}

// NewPublisher connects to JetStream and ensures the platform event stream
// exists before a service reports messaging readiness.
func NewPublisher(contextValue context.Context, url, name string, store *OutboxStore, logger *slog.Logger) (*Publisher, error) {
	if store == nil {
		return nil, fmt.Errorf("outbox store is required")
	}
	if logger == nil {
		return nil, fmt.Errorf("publisher logger is required")
	}
	connection, err := Connect(contextValue, url, name)
	if err != nil {
		return nil, err
	}
	stream, err := connection.JetStream(nats.PublishAsyncMaxPending(1024))
	if err != nil {
		connection.Close()
		return nil, fmt.Errorf("open JetStream context: %w", err)
	}
	if err := ensurePlatformStream(stream); err != nil {
		connection.Close()
		return nil, err
	}
	return &Publisher{
		store: store, connection: connection, stream: stream, logger: logger,
		batchSize: 100, lease: 30 * time.Second, interval: 200 * time.Millisecond,
	}, nil
}

func ensurePlatformStream(stream nats.JetStreamContext) error {
	if stream == nil {
		return fmt.Errorf("JetStream context is required")
	}
	if _, err := stream.StreamInfo(platformStream); err == nil {
		return nil
	} else if !errors.Is(err, nats.ErrStreamNotFound) {
		return fmt.Errorf("read platform event stream: %w", err)
	}
	_, err := stream.AddStream(&nats.StreamConfig{
		Name:       platformStream,
		Subjects:   []string{">"},
		Retention:  nats.LimitsPolicy,
		Storage:    nats.FileStorage,
		Discard:    nats.DiscardOld,
		MaxAge:     8 * 24 * time.Hour,
		Duplicates: 2 * time.Minute,
	})
	if err != nil && !errors.Is(err, nats.ErrStreamNameAlreadyInUse) {
		return fmt.Errorf("create platform event stream: %w", err)
	}
	return nil
}

// Run publishes until context cancellation. It logs a retryable failure but
// keeps the service alive because the outbox preserves every unsent event.
func (publisher *Publisher) Run(contextValue context.Context) {
	if publisher == nil {
		return
	}
	defer publisher.connection.Close()
	ticker := time.NewTicker(publisher.interval)
	defer ticker.Stop()
	for {
		if err := publisher.publishOnce(contextValue); err != nil {
			publisher.lastFailure.Store(err.Error())
			publisher.logger.Error("outbox publish failed", "error", err)
		} else {
			publisher.lastFailure.Store("")
		}
		select {
		case <-contextValue.Done():
			return
		case <-ticker.C:
		}
	}
}

func (publisher *Publisher) publishOnce(contextValue context.Context) error {
	events, err := publisher.store.Lease(contextValue, publisher.batchSize, publisher.lease)
	if err != nil {
		return err
	}
	if len(events) == 0 {
		return nil
	}
	return PublishBatch(contextValue, publisher.store, publisher.stream, events)
}

// Ready verifies the NATS connection and returns the latest publisher error
// rather than silently claiming readiness after a broker outage.
func (publisher *Publisher) Ready(contextValue context.Context) error {
	if publisher == nil || publisher.connection == nil || !publisher.connection.IsConnected() {
		return fmt.Errorf("platform event publisher is disconnected")
	}
	if failure, found := publisher.lastFailure.Load().(string); found && strings.TrimSpace(failure) != "" {
		return fmt.Errorf("platform event publisher retrying: %s", failure)
	}
	if _, err := publisher.stream.AccountInfo(); err != nil {
		return fmt.Errorf("check platform JetStream readiness: %w", err)
	}
	return nil
}
