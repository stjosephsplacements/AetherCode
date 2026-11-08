//go:build integration

package messaging

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/testutil/integration"
	"github.com/stretchr/testify/require"
)

func TestRetryHandledByPeerRestoresReadiness(t *testing.T) {
	ctx := context.Background()
	url := integration.StartNATS(ctx, t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	first, err := NewPullConsumer(ctx, url, "first", "shared_test", "user.test.v1", logger, func(context.Context, Event) error { return errors.New("temporary failure") })
	require.NoError(t, err)
	defer first.connection.Close()
	second, err := NewPullConsumer(ctx, url, "second", "shared_test", "user.test.v1", logger, func(context.Context, Event) error { return nil })
	require.NoError(t, err)
	defer second.connection.Close()
	event := Event{ID: "example", Type: "user.test.v1", SchemaVersion: 1, AggregateType: "example", AggregateID: "1", OccurredAt: time.Now(), Payload: json.RawMessage(`{}`)}
	data, err := event.Encode()
	require.NoError(t, err)
	_, err = first.stream.Publish(event.Type, data)
	require.NoError(t, err)
	msgs, err := first.subscription.Fetch(1, nats.MaxWait(3*time.Second))
	require.NoError(t, err)
	first.handleMessage(ctx, msgs[0])
	require.Error(t, first.Ready(ctx))

	// A later successful event cannot hide the earlier unacknowledged retry.
	first.handler = func(context.Context, Event) error { return nil }
	event.ID = "later"
	data, err = event.Encode()
	require.NoError(t, err)
	_, err = first.stream.Publish(event.Type, data)
	require.NoError(t, err)
	msgs, err = first.subscription.Fetch(1, nats.MaxWait(time.Second))
	require.NoError(t, err)
	first.handleMessage(ctx, msgs[0])
	require.Error(t, first.Ready(ctx))

	msgs, err = second.subscription.Fetch(1, nats.MaxWait(5*time.Second))
	require.NoError(t, err)
	second.handleMessage(ctx, msgs[0])
	require.Eventually(t, func() bool { return first.Ready(ctx) == nil }, 3*time.Second, 100*time.Millisecond)
}
