# ADR-0056: Platform analytics reads Prometheus through the web UI, for platform administrators only

- Status: accepted
- Date: 2026-11-02

## Context

Analytics showed exam results only. Nothing showed how the platform itself was doing:
which services are up, how busy they are, how long requests take, whether the database
pools are full. The cluster already runs Prometheus and Grafana, and every Go service
serves `/metrics` (request counts, latency, database pool), but Prometheus was not
scraping the services, so request metrics existed nowhere.

## Decision

**Collect.** The platform-service chart renders a `ServiceMonitor` per release, so
Prometheus scrapes each service's `/metrics` on its `http` port every 15 seconds. It is
rendered only where the Prometheus Operator is installed, is on unless a release opts
out (the web UI has no `/metrics`), and a missing `metrics` block counts as on because
`helm upgrade --reuse-values` does not bring in new chart defaults.

**Read.** The web UI queries Prometheus on the server (`PROMETHEUS_URL`), never from
the browser. Every query is fixed in `lib/platform-metrics.ts`; the route accepts only a
time range from a short list, so nobody can send PromQL. Results are limited to the
`aethercode` namespace.

**Who.** The Platform tab and `/api/platform/metrics` are for platform administrators:
the figures describe every college. Anyone else is redirected or refused.

**Show.** Live panels refresh every ten seconds while the tab is visible: pod and
deployment state, restarts, CPU, memory and network from the cluster's own metrics
(available immediately), and request rate, errors, latency and database connections from
the services (available once scraped). A panel with no data says so; nothing is invented.

## Consequences

- Request, error and latency panels stay empty until the services are redeployed with this chart.
- Prometheus is read-only here and unauthenticated inside the cluster, so the route's admin check is the control.
- Series colours are validated for both themes and always paired with a legend and a table view.
