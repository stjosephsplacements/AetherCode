package amqp

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/aethercode/aethercode/services/judge/internal/dispatcher"
	"github.com/rabbitmq/amqp091-go"
)

const consumerTag = "judge-dispatcher"

// Consumer reads admission pointers from the judge admission queue and
// dispatches each job through the Worker. It reconnects automatically after
// connection failures.
type Consumer struct {
	url    string
	worker *dispatcher.Worker
	logger *slog.Logger
}

// NewConsumer validates configuration and creates a Consumer. The rawURL must
// be the same JUDGE_RABBITMQ_URL used by the admission publisher so that the
// consumer reads from the same quorum queue.
func NewConsumer(rawURL string, worker *dispatcher.Worker, logger *slog.Logger) (*Consumer, error) {
	if worker == nil {
		return nil, fmt.Errorf("dispatcher consumer worker is required")
	}
	if logger == nil {
		return nil, fmt.Errorf("dispatcher consumer logger is required")
	}
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (parsed.Scheme != "amqp" && parsed.Scheme != "amqps") || parsed.Host == "" {
		return nil, fmt.Errorf("JUDGE_RABBITMQ_URL must be a valid amqp or amqps URL")
	}
	return &Consumer{url: parsed.String(), worker: worker, logger: logger}, nil
}

// Start connects to RabbitMQ and dispatches admission messages until ctx is
// cancelled. It reconnects automatically on transient connection failures.
// The returned error is always ctx.Err() on a clean shutdown.
func (c *Consumer) Start(ctx context.Context) error {
	for ctx.Err() == nil {
		if err := c.runConnection(ctx); err != nil && ctx.Err() == nil {
			c.logger.Error("dispatcher consumer connection failed, reconnecting", "error", err)
		}
		waitForRetry(ctx, time.Second)
	}
	return ctx.Err()
}

func (c *Consumer) runConnection(ctx context.Context) error {
	conn, err := amqp091.Dial(c.url)
	if err != nil {
		return fmt.Errorf("dial RabbitMQ: %w", err)
	}
	defer func() { _ = conn.Close() }()

	ch, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("open RabbitMQ channel: %w", err)
	}
	defer func() { _ = ch.Close() }()

	if _, err := ch.QueueDeclare(admissionQueue, true, false, false, false, amqp091.Table{
		"x-queue-type": "quorum",
	}); err != nil {
		return fmt.Errorf("declare judge admission quorum queue: %w", err)
	}

	deliveries, err := ch.Consume(admissionQueue, consumerTag, false, false, false, false, nil)
	if err != nil {
		return fmt.Errorf("register dispatcher consumer: %w", err)
	}

	closeCh := conn.NotifyClose(make(chan *amqp091.Error, 1))

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case amqpErr, open := <-closeCh:
			if !open || amqpErr == nil {
				return fmt.Errorf("AMQP connection closed unexpectedly")
			}
			return fmt.Errorf("AMQP connection error: %w", amqpErr)
		case delivery, open := <-deliveries:
			if !open {
				return fmt.Errorf("AMQP delivery channel closed")
			}
			c.handleDelivery(ctx, delivery)
		}
	}
}

type admissionPointer struct {
	EventID string `json:"event_id"`
	JobID   string `json:"job_id"`
}

func (c *Consumer) handleDelivery(ctx context.Context, delivery amqp091.Delivery) {
	var msg admissionPointer
	if err := json.Unmarshal(delivery.Body, &msg); err != nil {
		c.logger.Error("dispatcher: malformed admission pointer, discarding", "error", err)
		// Non-recoverable message format error: do not requeue.
		_ = delivery.Nack(false, false)
		return
	}
	if strings.TrimSpace(msg.JobID) == "" {
		c.logger.Error("dispatcher: admission pointer missing job_id, discarding")
		_ = delivery.Nack(false, false)
		return
	}

	if err := c.worker.DispatchJob(ctx, msg.JobID); err != nil {
		c.logger.Error("dispatcher: job dispatch failed, requeuing", "job_id", msg.JobID, "error", err)
		_ = delivery.Nack(false, true)
		return
	}

	_ = delivery.Ack(false)
}
