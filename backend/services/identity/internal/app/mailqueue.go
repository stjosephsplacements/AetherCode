package app

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

const (
	mailQueueCapacity = 256
	mailWorkers       = 4
	mailSendTimeout   = 30 * time.Second
)

type resetMail struct {
	to, token, requestID string
	validFor             time.Duration
}

// mailQueue is a bounded in-memory queue drained by a fixed set of workers. It is deliberately not durable: a crash
// loses the queued mail and the user asks again (ADR-0091).
type mailQueue struct {
	mailer Mailer
	jobs   chan resetMail
	wg     sync.WaitGroup

	mu     sync.RWMutex // a send on jobs happens under RLock so close cannot race it
	closed bool
}

func newMailQueue(mailer Mailer) *mailQueue {
	queue := &mailQueue{mailer: mailer, jobs: make(chan resetMail, mailQueueCapacity)}
	queue.wg.Add(mailWorkers)
	for range mailWorkers {
		go queue.work()
	}
	return queue
}

func (queue *mailQueue) work() {
	defer queue.wg.Done()
	for job := range queue.jobs {
		ctx, cancel := context.WithTimeout(context.Background(), mailSendTimeout)
		if err := queue.mailer.SendPasswordReset(ctx, job.to, job.token, job.validFor); err != nil {
			slog.Warn("password reset email was not sent", "request_id", job.requestID, "error", err)
		}
		cancel()
	}
}

// enqueue never blocks: when the queue is full or closed the mail is dropped and logged.
func (queue *mailQueue) enqueue(job resetMail) {
	queue.mu.RLock()
	defer queue.mu.RUnlock()
	if queue.closed {
		slog.Warn("password reset email dropped: mail queue is closed", "request_id", job.requestID)
		return
	}
	select {
	case queue.jobs <- job:
	default:
		slog.Warn("password reset email dropped: mail queue is full", "request_id", job.requestID)
	}
}

func (queue *mailQueue) close(ctx context.Context) error {
	queue.mu.Lock()
	if !queue.closed {
		queue.closed = true
		close(queue.jobs)
	}
	queue.mu.Unlock()
	drained := make(chan struct{})
	go func() {
		queue.wg.Wait()
		close(drained)
	}()
	select {
	case <-drained:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("drain mail queue: %w", ctx.Err())
	}
}
