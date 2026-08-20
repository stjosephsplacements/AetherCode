// Package telemetry provides OpenTelemetry tracing, HTTP middleware,
// and Prometheus metrics for AetherCode services.
package telemetry

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Registry exposes the Prometheus metrics endpoint for a service.
type Registry struct {
	service string
}

// NewRegistry creates a service-scoped metrics registry.
func NewRegistry(service string) *Registry {
	return &Registry{service: service}
}

// Handler returns the Prometheus metrics HTTP endpoint.
func (registry *Registry) Handler() http.Handler {
	return promhttp.Handler()
}

var (
	httpRequestsTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "http_requests_total",
		Help: "Total number of HTTP requests by method, path, and status.",
	}, []string{"method", "path", "status"})

	httpRequestDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "HTTP request latency in seconds by method and path.",
		Buckets: prometheus.DefBuckets,
	}, []string{"method", "path"})
)

func init() {
	prometheus.MustRegister(httpRequestsTotal, httpRequestDuration)
}
