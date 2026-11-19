package amqp

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"github.com/rabbitmq/amqp091-go"
	"github.com/stjosephsplacements/AetherCode/services/judge/internal/app"
)

type failingTracker struct {
	err   error
	calls *int
}

func (t failingTracker) MarkAdmissionConsumed(context.Context, string) error {
	if t.calls != nil {
		*t.calls++
	}
	return t.err
}

func pointer(t *testing.T, eventID, jobID string) string {
	t.Helper()
	body, err := json.Marshal(map[string]string{"event_id": eventID, "job_id": jobID})
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}

type recordingAck struct{ acks, nacks, requeues int }

func (a *recordingAck) Ack(uint64, bool) error { a.acks++; return nil }
func (a *recordingAck) Nack(_ uint64, _ bool, requeue bool) error {
	a.nacks++
	if requeue {
		a.requeues++
	}
	return nil
}
func (a *recordingAck) Reject(uint64, bool) error { return nil }

func delivery(ack *recordingAck, body string) amqp091.Delivery {
	return amqp091.Delivery{Acknowledger: ack, Body: []byte(body)}
}

// A pointer that cannot be marked consumed must go back to the queue without touching the worker (nil here, so a
// dispatch would panic): the job is not claimed, so dispatching it could run it twice.
func TestAPointerThatCannotBeMarkedIsRequeuedWithoutDispatch(t *testing.T) {
	ack := &recordingAck{}
	calls := 0
	consumer := &Consumer{tracker: failingTracker{err: errors.New("database down"), calls: &calls}, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // skip the pause
	consumer.handleDelivery(ctx, delivery(ack, pointer(t, uuid.NewString(), uuid.NewString())))
	if calls != 1 {
		t.Fatalf("the tracker was called %d times, want once: the delivery must reach the mark", calls)
	}
	if ack.nacks != 1 || ack.requeues != 1 || ack.acks != 0 {
		t.Fatalf("nacks=%d requeues=%d acks=%d, want one requeueing nack and no ack", ack.nacks, ack.requeues, ack.acks)
	}
}

func TestAPointerWithoutAValidEventIDIsDiscarded(t *testing.T) {
	ack := &recordingAck{}
	consumer := &Consumer{tracker: failingTracker{}, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	consumer.handleDelivery(context.Background(), delivery(ack, pointer(t, "nope", uuid.NewString())))
	if ack.nacks != 1 || ack.requeues != 0 {
		t.Fatalf("nacks=%d requeues=%d, want one discarding nack", ack.nacks, ack.requeues)
	}
}

// A pointer with no outbox row is not dispatched: nothing proves it was ever issued.
func TestAPointerWithNoOutboxRowIsDiscarded(t *testing.T) {
	ack := &recordingAck{}
	calls := 0
	consumer := &Consumer{tracker: failingTracker{err: app.ErrAdmissionUnknown, calls: &calls}, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	consumer.handleDelivery(context.Background(), delivery(ack, pointer(t, uuid.NewString(), uuid.NewString())))
	if calls != 1 || ack.nacks != 1 || ack.requeues != 0 || ack.acks != 0 {
		t.Fatalf("calls=%d nacks=%d requeues=%d acks=%d, want one mark attempt and one discarding nack", calls, ack.nacks, ack.requeues, ack.acks)
	}
}
