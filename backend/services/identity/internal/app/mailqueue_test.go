package app

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

type blockingMailer struct {
	release chan struct{}
	sent    atomic.Int32
}

func (mailer *blockingMailer) SendPasswordReset(context.Context, string, string, time.Duration) error {
	<-mailer.release
	mailer.sent.Add(1)
	return nil
}

func TestMailQueueDropsWhenFullAndDrainsOnClose(t *testing.T) {
	mailer := &blockingMailer{release: make(chan struct{})}
	queue := newMailQueue(mailer)
	// Every worker blocks on one mail, the buffer holds mailQueueCapacity more; anything beyond is dropped.
	total := mailWorkers + mailQueueCapacity
	for range total + 50 {
		queue.enqueue(resetMail{to: "asha@college.edu", token: "t", requestID: "r"})
	}
	if len(queue.jobs) > mailQueueCapacity {
		t.Fatalf("queue holds %d, capacity is %d", len(queue.jobs), mailQueueCapacity)
	}

	expired, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := queue.close(expired); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("close with stuck workers = %v, want the deadline error", err)
	}
	queue.enqueue(resetMail{to: "late@college.edu"}) // closed: dropped, must not panic

	close(mailer.release)
	if err := queue.close(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := int(mailer.sent.Load()); got < mailQueueCapacity || got > total {
		t.Fatalf("sent %d mails, want between %d and %d", got, mailQueueCapacity, total)
	}
}
