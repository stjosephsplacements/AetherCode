// Package amqp publishes durable, pointer-only Judge admission wake-ups.
package amqp

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"sync/atomic"
	"time"

	"github.com/aethercode/aethercode/services/judge/internal/adapters/repo"
	"github.com/rabbitmq/amqp091-go"
)

const (
	admissionQueue      = "judge.admission.v1"
	publisherLeaseFor   = 30 * time.Second
	publishConfirmLimit = 5 * time.Second
	stalePublishAge     = 2 * time.Minute
	reconcileInterval   = 30 * time.Second
)

// Publisher leases rows from judge.admission_outbox and sends a persistent
// pointer-only RabbitMQ message after broker confirmation. It never serializes
// candidate source, tests, execution material, or results into RabbitMQ.
type Publisher struct {
	url     string
	owner   string
	store   *repo.Postgres
	logger  *slog.Logger
	healthy atomic.Bool
}

// NewPublisher validates the minimal, private RabbitMQ configuration.
func NewPublisher(rawURL, owner string, store *repo.Postgres, logger *slog.Logger) (*Publisher, error) {
	if store == nil {
		return nil, fmt.Errorf("admission publisher store is required")
	}
	if logger == nil {
		return nil, fmt.Errorf("admission publisher logger is required")
	}
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (parsed.Scheme != "amqp" && parsed.Scheme != "amqps") || parsed.Host == "" {
		return nil, fmt.Errorf("JUDGE_RABBITMQ_URL must be a valid amqp or amqps URL")
	}
	if owner = strings.TrimSpace(owner); owner == "" || len(owner) > 255 {
		return nil, fmt.Errorf("JUDGE_PUBLISHER_ID must contain 1 to 255 characters")
	}
	return &Publisher{url: parsed.String(), owner: owner, store: store, logger: logger}, nil
}

// Run reconnects until shutdown. Every accepted job is already durable in
// PostgreSQL, so transient RabbitMQ loss delays admission but cannot lose it.
func (publisher *Publisher) Run(contextValue context.Context) {
	for contextValue.Err() == nil {
		if err := publisher.runConnection(contextValue); err != nil && contextValue.Err() == nil {
			publisher.logger.Error("Judge admission publisher connection failed", "error", err)
		}
		publisher.healthy.Store(false)
		waitForRetry(contextValue, time.Second)
	}
}

// Ready reports whether the publisher has a live broker-confirmed channel.
func (publisher *Publisher) Ready(context.Context) error {
	if !publisher.healthy.Load() {
		return fmt.Errorf("judge admission publisher is not connected to RabbitMQ")
	}
	return nil
}

func (publisher *Publisher) runConnection(contextValue context.Context) error {
	connection, err := amqp091.Dial(publisher.url)
	if err != nil {
		return fmt.Errorf("dial RabbitMQ: %w", err)
	}
	defer func() { _ = connection.Close() }()
	channel, err := connection.Channel()
	if err != nil {
		return fmt.Errorf("open RabbitMQ channel: %w", err)
	}
	defer func() { _ = channel.Close() }()
	if _, err := channel.QueueDeclare(admissionQueue, true, false, false, false, amqp091.Table{
		"x-queue-type": "quorum",
	}); err != nil {
		return fmt.Errorf("declare Judge admission quorum queue: %w", err)
	}
	if err := channel.Confirm(false); err != nil {
		return fmt.Errorf("enable RabbitMQ publisher confirms: %w", err)
	}
	confirms := channel.NotifyPublish(make(chan amqp091.Confirmation, 1))
	publisher.healthy.Store(true)
	lastReconcile := time.Time{}
	for contextValue.Err() == nil {
		if lastReconcile.IsZero() || time.Since(lastReconcile) >= reconcileInterval {
			requeued, reconcileErr := publisher.store.RequeueStalePublishedAdmissions(
				contextValue,
				time.Now().UTC().Add(-stalePublishAge),
				1000,
			)
			if reconcileErr != nil {
				return reconcileErr
			}
			if requeued > 0 {
				publisher.logger.Warn("requeued stale Judge admission pointers", "count", requeued)
			}
			lastReconcile = time.Now()
		}
		leases, err := publisher.store.LeaseAdmissions(contextValue, publisher.owner, 25, publisherLeaseFor)
		if err != nil {
			return err
		}
		if len(leases) == 0 {
			waitForRetry(contextValue, 250*time.Millisecond)
			continue
		}
		for _, lease := range leases {
			if err := publisher.publishOne(contextValue, channel, confirms, lease); err != nil {
				releaseErr := publisher.store.ReleaseAdmission(contextValue, lease.EventID, lease.LeaseID, time.Now().UTC().Add(time.Second), err)
				if releaseErr != nil {
					return fmt.Errorf("publish admission %s: %w; release lease: %w", lease.EventID, err, releaseErr)
				}
				return fmt.Errorf("publish admission %s: %w", lease.EventID, err)
			}
			if err := publisher.store.MarkAdmissionPublished(contextValue, lease.EventID, lease.LeaseID); err != nil {
				// The broker may already have received the pointer. Returning an
				// error deliberately causes an at-least-once replay; workers must
				// record event_id before acknowledging RabbitMQ.
				return fmt.Errorf("record broker-confirmed admission %s: %w", lease.EventID, err)
			}
		}
	}
	return contextValue.Err()
}

func (publisher *Publisher) publishOne(
	contextValue context.Context,
	channel *amqp091.Channel,
	confirms <-chan amqp091.Confirmation,
	lease repo.AdmissionLease,
) error {
	body, err := json.Marshal(struct {
		EventID string `json:"event_id"`
		JobID   string `json:"job_id"`
	}{EventID: lease.EventID, JobID: lease.JobID})
	if err != nil {
		return fmt.Errorf("encode admission pointer: %w", err)
	}
	publishContext, cancel := context.WithTimeout(contextValue, publishConfirmLimit)
	defer cancel()
	if err := channel.PublishWithContext(publishContext, "", admissionQueue, false, false, amqp091.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp091.Persistent,
		MessageId:    lease.EventID,
		Timestamp:    time.Now().UTC(),
		Body:         body,
	}); err != nil {
		return fmt.Errorf("publish admission pointer: %w", err)
	}
	select {
	case confirmation, open := <-confirms:
		if !open {
			return fmt.Errorf("RabbitMQ publisher-confirm channel closed")
		}
		if !confirmation.Ack {
			return fmt.Errorf("RabbitMQ negatively acknowledged admission pointer")
		}
		return nil
	case <-publishContext.Done():
		return fmt.Errorf("wait for RabbitMQ publisher confirm: %w", publishContext.Err())
	}
}

func waitForRetry(contextValue context.Context, delay time.Duration) {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-contextValue.Done():
	case <-timer.C:
	}
}
