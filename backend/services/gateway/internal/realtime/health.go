// Package realtime pushes service health and change hints to staff browsers
// over a WebSocket (ADR-0050). It never forwards event payloads: a hint tells
// a page to refetch through the APIs that already authorise it.
package realtime

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"
)

// Service is one upstream's readiness as the gateway sees it.
type Service struct {
	Name         string `json:"name"`
	Description  string `json:"description,omitempty"`
	Ready        bool   `json:"ready"`
	Milliseconds int64  `json:"milliseconds"`
}

// Health is a full snapshot; it is what the status page renders.
type Health struct {
	Type      string    `json:"type"`
	CheckedAt time.Time `json:"checked_at"`
	Services  []Service `json:"services"`
}

// Prober checks every configured upstream on an interval and keeps the latest
// snapshot. The service list is the gateway's own routing table, nothing else.
type Prober struct {
	upstreams    map[string]*url.URL
	descriptions map[string]string
	client       *http.Client
	interval     time.Duration
	now          func() time.Time

	mu     sync.RWMutex
	latest Health
}

func NewProber(upstreams map[string]*url.URL, descriptions map[string]string, client *http.Client, interval time.Duration) *Prober {
	return &Prober{upstreams: upstreams, descriptions: descriptions, client: client, interval: interval, now: time.Now}
}

// Latest returns the most recent snapshot; it is empty before the first probe.
func (prober *Prober) Latest() Health {
	prober.mu.RLock()
	defer prober.mu.RUnlock()
	return prober.latest
}

// Run probes immediately, then on every tick, handing each snapshot to publish.
func (prober *Prober) Run(ctx context.Context, publish func(Health)) {
	ticker := time.NewTicker(prober.interval)
	defer ticker.Stop()
	for {
		snapshot := prober.Probe(ctx)
		prober.mu.Lock()
		prober.latest = snapshot
		prober.mu.Unlock()
		publish(snapshot)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Probe checks every upstream in parallel; each check is bounded by the interval.
func (prober *Prober) Probe(ctx context.Context) Health {
	ctx, cancel := context.WithTimeout(ctx, prober.interval)
	defer cancel()
	services := make([]Service, 0, len(prober.upstreams))
	var mu sync.Mutex
	var wait sync.WaitGroup
	for name, upstream := range prober.upstreams {
		wait.Go(func() {
			started := time.Now()
			ready := prober.ready(ctx, upstream)
			mu.Lock()
			services = append(services, Service{Name: name, Description: prober.descriptions[name], Ready: ready, Milliseconds: time.Since(started).Milliseconds()})
			mu.Unlock()
		})
	}
	wait.Wait()
	slices.SortFunc(services, func(a, b Service) int { return strings.Compare(a.Name, b.Name) })
	return Health{Type: "health", CheckedAt: prober.now().UTC(), Services: services}
}

func (prober *Prober) ready(ctx context.Context, upstream *url.URL) bool {
	target := *upstream
	target.Path = strings.TrimRight(target.Path, "/") + "/healthz"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return false
	}
	response, err := prober.client.Do(request)
	if err != nil {
		return false
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	_ = response.Body.Close()
	return response.StatusCode >= http.StatusOK && response.StatusCode < http.StatusMultipleChoices
}
