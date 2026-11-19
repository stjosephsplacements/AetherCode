package amqp

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"github.com/rabbitmq/amqp091-go"
)

type failingTracker struct{ err error }

func (t failingTracker) MarkAdmissionConsumed(context.Context, string) error { return t.err }

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
	consumer := &Consumer{tracker: failingTracker{err: errors.New("database down")}, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // skip the pause
	consumer.handleDelivery(ctx, delivery(ack, `{"event_id":"`+uuid.NewString()+`","job_id":"`+uuid.NewString()+`"}`))
	if ack.nacks != 1 || ack.requeues != 1 || ack.acks != 0 {
		t.Fatalf("nacks=%d requeues=%d acks=%d, want one requeueing nack and no ack", ack.nacks, ack.requeues, ack.acks)
	}
}

func TestAPointerWithoutAValidEventIDIsDiscarded(t *testing.T) {
	ack := &recordingAck{}
	consumer := &Consumer{tracker: failingTracker{}, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	consumer.handleDelivery(context.Background(), delivery(ack, `{"event_id":"nope","job_id":"`+uuid.NewString()+`"}`))
	if ack.nacks != 1 || ack.requeues != 0 {
		t.Fatalf("nacks=%d requeues=%d, want one discarding nack", ack.nacks, ack.requeues)
	}
}
