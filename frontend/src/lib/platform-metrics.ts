/**
 * What the Platform analytics page asks Prometheus, and how it reads the answers.
 * Every query is fixed here; the browser never sends PromQL.
 */

export const SERVICES = ["gateway", "identity", "tenant", "user", "question-bank", "assessment", "submission", "judge", "seb", "notification", "analytics", "frontend"] as const;
export type ServiceName = (typeof SERVICES)[number];

export const RANGES = {
  "15m": { seconds: 15 * 60, step: 15, label: "15 min" },
  "1h": { seconds: 60 * 60, step: 30, label: "1 hour" },
  "6h": { seconds: 6 * 60 * 60, step: 120, label: "6 hours" },
  "24h": { seconds: 24 * 60 * 60, step: 300, label: "24 hours" },
} as const;
export type RangeKey = keyof typeof RANGES;
export const isRange = (value: string | null | undefined): value is RangeKey => !!value && value in RANGES;

export type Point = [time: number, value: number];
export type Series = { name: string; points: Point[] };

const NS = 'namespace="aethercode"';
const CONTAINERS = 'container!="",container!="POD"';
/** A pod's service from its name: "user-5cb6ff55df-djst5" is user, "nats-0" is nats. */
const byService = (selector: string) =>
  `label_replace(label_replace(${selector},"service","$1","pod","(.*)-[a-z0-9]+-[a-z0-9]+"),"service","$1","pod","(.*)-[0-9]+")`;

/** Range queries, one chart each. `by` is the label that names a series. */
export const RANGE_QUERIES = {
  requests: { by: "job", query: `sum by (job) (rate(http_requests_total{${NS}}[1m]))` },
  errors: { by: "job", query: `sum by (job) (rate(http_requests_total{${NS},status=~"5.."}[1m])) / sum by (job) (rate(http_requests_total{${NS}}[1m]))` },
  latency: { by: "job", query: `histogram_quantile(0.95, sum by (le, job) (rate(http_request_duration_seconds_bucket{${NS}}[2m])))` },
  cpu: { by: "service", query: `sum by (service) (${byService(`rate(container_cpu_usage_seconds_total{${NS},${CONTAINERS}}[2m])`)})` },
  memory: { by: "service", query: `sum by (service) (${byService(`container_memory_working_set_bytes{${NS},${CONTAINERS}}`)})` },
  networkIn: { by: "", query: `sum(rate(container_network_receive_bytes_total{${NS}}[2m]))` },
  networkOut: { by: "", query: `sum(rate(container_network_transmit_bytes_total{${NS}}[2m]))` },
  dbInUse: { by: "job", query: `sum by (job) (db_pool_in_use_connections{${NS}})` },
} as const satisfies Record<string, { by: string; query: string }>;
export type RangeQueryKey = keyof typeof RANGE_QUERIES;

/** Instant queries: the headline figures and the service table. */
export const INSTANT_QUERIES = {
  clusterCpu: { by: "", query: `1 - avg(rate(node_cpu_seconds_total{mode="idle"}[2m]))` },
  clusterMemory: { by: "", query: `1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)` },
  restarts24h: { by: "", query: `sum(increase(kube_pod_container_status_restarts_total{${NS}}[24h]))` },
  podsNotReady: { by: "", query: `count(kube_pod_status_ready{${NS},condition="false"} == 1) or vector(0)` },
  requestRate: { by: "", query: `sum(rate(http_requests_total{${NS}}[1m]))` },
  errorRate: { by: "", query: `sum(rate(http_requests_total{${NS},status=~"5.."}[1m])) / sum(rate(http_requests_total{${NS}}[1m]))` },
  latencyP95: { by: "", query: `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{${NS}}[2m])))` },
  available: { by: "deployment", query: `kube_deployment_status_replicas_available{${NS}}` },
  desired: { by: "deployment", query: `kube_deployment_spec_replicas{${NS}}` },
  cpuNow: { by: "service", query: `sum by (service) (${byService(`rate(container_cpu_usage_seconds_total{${NS},${CONTAINERS}}[2m])`)})` },
  memoryNow: { by: "service", query: `sum by (service) (${byService(`container_memory_working_set_bytes{${NS},${CONTAINERS}}`)})` },
  restartsNow: { by: "service", query: `sum by (service) (${byService(`increase(kube_pod_container_status_restarts_total{${NS}}[24h])`)})` },
  requestsNow: { by: "job", query: `sum by (job) (rate(http_requests_total{${NS}}[1m]))` },
  errorsNow: { by: "job", query: `sum by (job) (rate(http_requests_total{${NS},status=~"5.."}[1m])) / sum by (job) (rate(http_requests_total{${NS}}[1m]))` },
  latencyNow: { by: "job", query: `histogram_quantile(0.95, sum by (le, job) (rate(http_request_duration_seconds_bucket{${NS}}[2m])))` },
} as const satisfies Record<string, { by: string; query: string }>;
export type InstantQueryKey = keyof typeof INSTANT_QUERIES;

type Matrix = { metric: Record<string, string>; values: [number, string][] }[];
type Vector = { metric: Record<string, string>; value: [number, string] }[];

const finite = (text: string): number | null => {
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

/** A Prometheus matrix as named series; NaN and infinite samples (an empty ratio) are dropped. */
export function toSeries(result: Matrix, by: string, fallbackName: string, keep?: (name: string) => boolean): Series[] {
  return result
    .map((entry) => ({
      name: by ? (entry.metric[by] ?? fallbackName) : fallbackName,
      points: entry.values.flatMap(([time, text]) => {
        const value = finite(text);
        return value === null ? [] : [[time, value] as Point];
      }),
    }))
    .filter((series) => series.points.length > 0 && (!keep || keep(series.name)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A Prometheus vector as name to value, dropping anything that is not a number. */
export function toValues(result: Vector, by: string, keep?: (name: string) => boolean): Map<string, number> {
  const values = new Map<string, number>();
  for (const entry of result) {
    const value = finite(entry.value[1]);
    const name = by ? entry.metric[by] : "value";
    if (value !== null && name && (!keep || keep(name))) values.set(name, value);
  }
  return values;
}

export const isService = (name: string) => (SERVICES as readonly string[]).includes(name);

/** What each service row of the table shows. Anything without data is null, not zero. */
export type ServiceRow = {
  name: string;
  available: number | null;
  desired: number | null;
  cpu: number | null;
  memory: number | null;
  restarts: number | null;
  requests: number | null;
  errors: number | null;
  latency: number | null;
};

export type Collection = "ok" | "unconfigured" | "unreachable";

export type Snapshot = {
  generatedAt: number;
  range: RangeKey;
  prometheus: Collection;
  /** Whether the services' own /metrics are being scraped (request rate and latency exist). */
  appMetrics: boolean;
  stats: Record<"clusterCpu" | "clusterMemory" | "restarts24h" | "podsNotReady" | "requestRate" | "errorRate" | "latencyP95", number | null>;
  charts: Record<"requests" | "errors" | "latency" | "cpu" | "memory" | "network" | "db", Series[]>;
  services: ServiceRow[];
};

export const emptySnapshot = (range: RangeKey, prometheus: Collection): Snapshot => ({
  generatedAt: Date.now(),
  range,
  prometheus,
  appMetrics: false,
  stats: { clusterCpu: null, clusterMemory: null, restarts24h: null, podsNotReady: null, requestRate: null, errorRate: null, latencyP95: null },
  charts: { requests: [], errors: [], latency: [], cpu: [], memory: [], network: [], db: [] },
  services: [],
});

// Formatting ---------------------------------------------------------------

export const formatBytes = (bytes: number): string => {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${bytes < 0 ? "-" : ""}${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
};

export const formatRate = (perSecond: number): string => (perSecond >= 10 ? `${Math.round(perSecond)}/s` : perSecond >= 1 ? `${perSecond.toFixed(1)}/s` : `${perSecond.toFixed(2)}/s`);

export const formatLatency = (seconds: number): string => (seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(2)} s`);

export const formatCores = (cores: number): string => (cores < 0.1 ? `${Math.round(cores * 1000)}m` : cores.toFixed(2));

export const formatShare = (share: number): string => (share < 0.1 ? `${(share * 100).toFixed(1)}%` : `${Math.round(share * 100)}%`);

export const formatCount = (value: number): string => (Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value)));
