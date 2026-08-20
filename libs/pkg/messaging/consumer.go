package messaging

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"

	"github.com/nats-io/nats.go"
)

// EventHandler applies one validated event. Returning an error leaves the
// message unacknowledged for durable redelivery; implementations must use a
// transactional inbox before reporting success.
type EventHandler func(context.Context, Event) error

// PermanentError identifies an event that is structurally invalid for a
// consumer's declared contract. It is terminated rather than retried forever;
// operators still receive the consumer error log and JetStream advisory.
type PermanentError struct{ Err error }

func (errorValue PermanentError) Error() string {
	if errorValue.Err == nil {
		return "permanent event error"
	}
	return errorValue.Err.Error()
}

func (errorValue PermanentError) Unwrap() error { return errorValue.Err }

// Permanent wraps a non-retryable schema or invariant error.
func Permanent(err error) error {
	if err == nil {
		return nil
	}
	return PermanentError{Err: err}
}

// PullConsumer is a crash-safe JetStream consumer for one versioned event
// subject. A durable name identifies the logical projection, so replicas may
// take over delivery without replaying side effects outside their inbox.
type PullConsumer struct {
	connection   *nats.Conn
	stream       nats.JetStreamContext
	subscription *nats.Subscription
	handler      EventHandler
	logger       *slog.Logger
	batchSize    int
	lastFailure  atomic.Value
}

// NewPullConsumer creates or binds a durable explicit-ack consumer. It starts
// from the beginning only on its first creation; an existing durable resumes
// from its acknowledged sequence.
func NewPullConsumer(
	contextValue context.Context,
	url, name, durable, subject string,
	logger *slog.Logger,
	handler EventHandler,
) (*PullConsumer, error) {
	if strings.TrimSpace(name) == "" || strings.TrimSpace(durable) == "" || strings.TrimSpace(subject) == "" {
		return nil, fmt.Errorf("consumer name, durable name, and subject are required")
	}
	if logger == nil || handler == nil {
		return nil, fmt.Errorf("consumer logger and handler are required")
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
	subscription, err := stream.PullSubscribe(
		subject,
		durable,
		nats.BindStream(platformStream),
		nats.DeliverAll(),
		nats.ManualAck(),
		nats.AckExplicit(),
		nats.MaxAckPending(1000),
	)
	if err != nil {
		connection.Close()
		return nil, fmt.Errorf("create durable consumer %q for %q: %w", durable, subject, err)
	}
	return &PullConsumer{
		connection: connection, stream: stream, subscription: subscription,
		handler: handler, logger: logger, batchSize: 100,
	}, nil
}

// Run processes messages until cancellation. A malformed envelope is terminal
// because retrying it cannot recover; valid events that fail their local
// transaction are NAKed with delay and retain at-least-once delivery.
func (consumer *PullConsumer) Run(contextValue context.Context) {
	if consumer == nil {
		return
	}
	defer consumer.connection.Close()
	for {
		if err := contextValue.Err(); err != nil {
			return
		}
		fetchContext, cancel := context.WithTimeout(contextValue, 2*time.Second)
		messages, err := consumer.subscription.Fetch(consumer.batchSize, nats.Context(fetchContext))
		cancel()
		if err != nil {
			if contextValue.Err() != nil || errors.Is(err, nats.ErrTimeout) {
				continue
			}
			consumer.recordFailure("fetch durable event", err)
			continue
		}
		for _, message := range messages {
			consumer.handleMessage(contextValue, message)
		}
	}
}

func (consumer *PullConsumer) handleMessage(contextValue context.Context, message *nats.Msg) {
	if message == nil {
		return
	}
	var event Event
	if err := json.Unmarshal(message.Data, &event); err != nil || event.Validate() != nil {
		consumer.recordFailure("decode durable event", fmt.Errorf("invalid platform event envelope"))
		if termErr := message.Term(); termErr != nil {
			consumer.recordFailure("terminate malformed durable event", termErr)
		}
		return
	}
	if event.Type != message.Subject {
		consumer.recordFailure("validate durable event subject", fmt.Errorf("event subject does not match envelope type"))
		if termErr := message.Term(); termErr != nil {
			consumer.recordFailure("terminate mismatched durable event", termErr)
		}
		return
	}
	if err := consumer.handler(contextValue, event); err != nil {
		consumer.recordFailure("apply durable event", err)
		var permanentError PermanentError
		if errors.As(err, &permanentError) {
			if termErr := message.Term(); termErr != nil {
				consumer.recordFailure("terminate invalid durable event", termErr)
			}
			return
		}
		if nakErr := message.NakWithDelay(2 * time.Second); nakErr != nil {
			consumer.recordFailure("retry durable event", nakErr)
		}
		return
	}
	if err := message.Ack(); err != nil {
		consumer.recordFailure("ack durable event", err)
		return
	}
	consumer.lastFailure.Store("")
}

// Ready exposes broker and consumer health to service readiness checks.
func (consumer *PullConsumer) Ready(contextValue context.Context) error {
	if consumer == nil || consumer.connection == nil || !consumer.connection.IsConnected() {
		return fmt.Errorf("platform event consumer is disconnected")
	}
	if failure, found := consumer.lastFailure.Load().(string); found && strings.TrimSpace(failure) != "" {
		return fmt.Errorf("platform event consumer retrying: %s", failure)
	}
	if _, err := consumer.stream.AccountInfo(); err != nil {
		return fmt.Errorf("check platform JetStream consumer readiness: %w", err)
	}
	return nil
}

func (consumer *PullConsumer) recordFailure(operation string, err error) {
	if consumer == nil || err == nil {
		return
	}
	consumer.lastFailure.Store(err.Error())
	consumer.logger.Error(operation, "error", err)
}
