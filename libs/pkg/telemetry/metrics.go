// Package telemetry provides the baseline service metrics endpoint.
package telemetry

import (
	"fmt"
	"net/http"
	"strconv"
	"sync/atomic"
	"time"
)

// Registry exposes minimal process metrics without coupling domain code to a
// vendor. OpenTelemetry exporters can collect and enrich these at deployment.
type Registry struct {
	service   string
	startedAt time.Time
	requests  atomic.Uint64
}

// NewRegistry creates a service-scoped metrics registry.
func NewRegistry(service string) *Registry {
	return &Registry{service: service, startedAt: time.Now().UTC()}
}

// Handler returns Prometheus text exposition for baseline availability metrics.
func (registry *Registry) Handler() http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		registry.requests.Add(1)
		writer.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		_, _ = fmt.Fprintf(writer, "aethercode_service_requests_total{service=%q} %d\n", registry.service, registry.requests.Load())
		_, _ = fmt.Fprintf(writer, "aethercode_service_started_unix{service=%q} %s\n", registry.service, strconv.FormatInt(registry.startedAt.Unix(), 10))
	})
}
