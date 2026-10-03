// Package dbmetrics registers pgx pool connection metrics with Prometheus.
// Import this package only in services that use a pgx connection pool.
package dbmetrics

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
)

// Register exports db_pool_total_connections, db_pool_idle_connections, and
// db_pool_in_use_connections gauges for a named pool. Call once per pool after
// the pool is created, before the first request.
func Register(serviceName string, pool *pgxpool.Pool) {
	prometheus.MustRegister(newCollector(serviceName, pool))
}

type poolCollector struct {
	service   string
	pool      *pgxpool.Pool
	totalDesc *prometheus.Desc
	idleDesc  *prometheus.Desc
	inUseDesc *prometheus.Desc
}

func newCollector(service string, pool *pgxpool.Pool) *poolCollector {
	labels := prometheus.Labels{"service": service}
	return &poolCollector{
		service:   service,
		pool:      pool,
		totalDesc: prometheus.NewDesc("db_pool_total_connections", "Total DB pool connections", nil, labels),
		idleDesc:  prometheus.NewDesc("db_pool_idle_connections", "Idle DB pool connections", nil, labels),
		inUseDesc: prometheus.NewDesc("db_pool_in_use_connections", "In-use DB pool connections", nil, labels),
	}
}

func (c *poolCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- c.totalDesc
	ch <- c.idleDesc
	ch <- c.inUseDesc
}

func (c *poolCollector) Collect(ch chan<- prometheus.Metric) {
	stat := c.pool.Stat()
	ch <- prometheus.MustNewConstMetric(c.totalDesc, prometheus.GaugeValue, float64(stat.TotalConns()))
	ch <- prometheus.MustNewConstMetric(c.idleDesc, prometheus.GaugeValue, float64(stat.IdleConns()))
	ch <- prometheus.MustNewConstMetric(c.inUseDesc, prometheus.GaugeValue, float64(stat.TotalConns()-stat.IdleConns()))
}
