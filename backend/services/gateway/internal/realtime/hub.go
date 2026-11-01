package realtime

import (
	"encoding/json"
	"strings"
	"sync"
	"time"
)

// Hint tells a page that something it shows has changed. It carries no data.
type Hint struct {
	Type  string    `json:"type"`
	Topic string    `json:"topic"`
	ID    string    `json:"id,omitempty"`
	At    time.Time `json:"at"`
}

// envelope is the part of a platform event the gateway reads; Payload is ignored.
type envelope struct {
	Type        string    `json:"type"`
	AggregateID string    `json:"aggregate_id"`
	TenantID    string    `json:"tenant_id"`
	OccurredAt  time.Time `json:"occurred_at"`
}

// Subjects the gateway listens on. Anything not mapped by topicOf is dropped.
var Subjects = []string{"submission.>", "judge.>", "user.staff_audit_recorded.v1"}

// topicOf is the allowlist: an event type becomes a topic only when listed here.
func topicOf(eventType string) string {
	switch {
	case strings.HasPrefix(eventType, "submission.attempt_"):
		return "attempts"
	case eventType == "submission.evaluation_requested.v1", eventType == "judge.completed.v1":
		return "grading"
	case eventType == "user.staff_audit_recorded.v1":
		return "activity"
	}
	return ""
}

// HintFor turns a raw event into a hint and its tenant, or reports false.
func HintFor(data []byte) (Hint, string, bool) {
	var event envelope
	if err := json.Unmarshal(data, &event); err != nil || event.TenantID == "" {
		return Hint{}, "", false
	}
	topic := topicOf(event.Type)
	if topic == "" {
		return Hint{}, "", false
	}
	return Hint{Type: "changed", Topic: topic, ID: event.AggregateID, At: event.OccurredAt.UTC()}, event.TenantID, true
}

type client struct {
	principal string
	tenant    string
	health    bool
	send      chan []byte
}

// Hub fans messages out to connected clients. A client that cannot keep up
// misses messages rather than slowing everyone else down.
type Hub struct {
	maxPerPrincipal int

	mu      sync.RWMutex
	clients map[*client]struct{}
}

func NewHub(maxPerPrincipal int) *Hub {
	return &Hub{maxPerPrincipal: maxPerPrincipal, clients: make(map[*client]struct{})}
}

// add registers a client, refusing a principal that already holds the maximum.
func (hub *Hub) add(entry *client) bool {
	hub.mu.Lock()
	defer hub.mu.Unlock()
	open := 0
	for existing := range hub.clients {
		if existing.principal == entry.principal {
			open++
		}
	}
	if open >= hub.maxPerPrincipal {
		return false
	}
	hub.clients[entry] = struct{}{}
	return true
}

func (hub *Hub) remove(entry *client) {
	hub.mu.Lock()
	defer hub.mu.Unlock()
	delete(hub.clients, entry)
}

func (hub *Hub) broadcast(message []byte, include func(*client) bool) {
	hub.mu.RLock()
	defer hub.mu.RUnlock()
	for entry := range hub.clients {
		if !include(entry) {
			continue
		}
		select {
		case entry.send <- message:
		default:
		}
	}
}

// PublishHealth sends a snapshot to every client allowed to see health.
func (hub *Hub) PublishHealth(snapshot Health) {
	message, err := json.Marshal(snapshot)
	if err != nil {
		return
	}
	hub.broadcast(message, func(entry *client) bool { return entry.health })
}

// PublishEvent turns a raw platform event into a hint for its tenant's clients.
func (hub *Hub) PublishEvent(data []byte) {
	hint, tenant, ok := HintFor(data)
	if !ok {
		return
	}
	message, err := json.Marshal(hint)
	if err != nil {
		return
	}
	hub.broadcast(message, func(entry *client) bool { return entry.tenant == tenant })
}
