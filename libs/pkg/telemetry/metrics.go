// Package telemetry provides OpenTelemetry tracing, HTTP middleware,
// and Prometheus metrics for AetherCode services.
package telemetry

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
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

// RegisterDBPool registers a pgx pool's connection metrics with Prometheus.
// Call this once per pool after the pool is created in each service's main.go.
func RegisterDBPool(service string, pool *pgxpool.Pool) {
	prometheus.MustRegister(newDBPoolCollector(service, pool))
}

type dbPoolCollector struct {
	service   string
	pool      *pgxpool.Pool
	totalDesc *prometheus.Desc
	idleDesc  *prometheus.Desc
	inUseDesc *prometheus.Desc
}

func newDBPoolCollector(service string, pool *pgxpool.Pool) *dbPoolCollector {
	labels := prometheus.Labels{"service": service}
	return &dbPoolCollector{
		service:   service,
		pool:      pool,
		totalDesc: prometheus.NewDesc("db_pool_total_connections", "Total DB pool connections", nil, labels),
		idleDesc:  prometheus.NewDesc("db_pool_idle_connections", "Idle DB pool connections", nil, labels),
		inUseDesc: prometheus.NewDesc("db_pool_in_use_connections", "In-use DB pool connections", nil, labels),
	}
}

func (c *dbPoolCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- c.totalDesc
	ch <- c.idleDesc
	ch <- c.inUseDesc
}

func (c *dbPoolCollector) Collect(ch chan<- prometheus.Metric) {
	stat := c.pool.Stat()
	ch <- prometheus.MustNewConstMetric(c.totalDesc, prometheus.GaugeValue, float64(stat.TotalConns()))
	ch <- prometheus.MustNewConstMetric(c.idleDesc, prometheus.GaugeValue, float64(stat.IdleConns()))
	ch <- prometheus.MustNewConstMetric(c.inUseDesc, prometheus.GaugeValue, float64(stat.TotalConns()-stat.IdleConns()))
}
