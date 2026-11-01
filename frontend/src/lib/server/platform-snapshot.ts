import "server-only";
import {
  INSTANT_QUERIES,
  type InstantQueryKey,
  RANGES,
  RANGE_QUERIES,
  type RangeKey,
  type RangeQueryKey,
  type ServiceRow,
  type Series,
  SERVICES,
  type Snapshot,
  emptySnapshot,
  isService,
  toSeries,
  toValues,
} from "@/lib/platform-metrics";
import { prometheusURL, instant, range } from "./prometheus";

type Matrix = Parameters<typeof toSeries>[0];
type Vector = Parameters<typeof toValues>[0];

/** Everything the Platform page draws, in one round of parallel queries. A query that fails leaves its panel empty. */
export async function loadSnapshot(key: RangeKey): Promise<Snapshot> {
  if (!prometheusURL()) return emptySnapshot(key, "unconfigured");
  const end = Math.floor(Date.now() / 1000);
  const { seconds, step } = RANGES[key];
  const start = end - seconds;

  let reached = false;
  const series = async (name: RangeQueryKey, keep?: (name: string) => boolean): Promise<Series[]> => {
    const { by, query } = RANGE_QUERIES[name];
    try {
      const result = toSeries(await range<Matrix>(query, start, end, step), by, name, keep);
      reached = true;
      return result;
    } catch {
      return [];
    }
  };
  const values = async (name: InstantQueryKey, keep?: (name: string) => boolean) => {
    const { by, query } = INSTANT_QUERIES[name];
    try {
      const result = toValues(await instant<Vector>(query), by, keep);
      reached = true;
      return result;
    } catch {
      return new Map<string, number>();
    }
  };

  const [requests, errors, latency, cpu, memory, networkIn, networkOut, database] = await Promise.all([
    series("requests", isService),
    series("errors", isService),
    series("latency", isService),
    series("cpu", isService),
    series("memory", isService),
    series("networkIn"),
    series("networkOut"),
    series("dbInUse", isService),
  ]);
  const [clusterCpu, clusterMemory, restarts24h, podsNotReady, requestRate, errorRate, latencyP95, available, desired, cpuNow, memoryNow, restartsNow, requestsNow, errorsNow, latencyNow] = await Promise.all([
    values("clusterCpu"),
    values("clusterMemory"),
    values("restarts24h"),
    values("podsNotReady"),
    values("requestRate"),
    values("errorRate"),
    values("latencyP95"),
    values("available"),
    values("desired"),
    values("cpuNow", isService),
    values("memoryNow", isService),
    values("restartsNow", isService),
    values("requestsNow", isService),
    values("errorsNow", isService),
    values("latencyNow", isService),
  ]);

  const one = (map: Map<string, number>) => map.get("value") ?? null;
  const rows: ServiceRow[] = SERVICES.map((name) => ({
    name,
    available: available.get(name) ?? null,
    desired: desired.get(name) ?? null,
    cpu: cpuNow.get(name) ?? null,
    memory: memoryNow.get(name) ?? null,
    restarts: restartsNow.get(name) ?? null,
    requests: requestsNow.get(name) ?? null,
    errors: errorsNow.get(name) ?? null,
    latency: latencyNow.get(name) ?? null,
  }));

  return {
    generatedAt: Date.now(),
    range: key,
    prometheus: reached ? "ok" : "unreachable",
    appMetrics: requests.length > 0,
    stats: {
      clusterCpu: one(clusterCpu),
      clusterMemory: one(clusterMemory),
      restarts24h: one(restarts24h),
      podsNotReady: one(podsNotReady),
      requestRate: one(requestRate),
      errorRate: one(errorRate),
      latencyP95: one(latencyP95),
    },
    charts: {
      requests,
      errors,
      latency,
      cpu,
      memory,
      network: [...networkIn.map((entry) => ({ ...entry, name: "in" })), ...networkOut.map((entry) => ({ ...entry, name: "out" }))],
      db: database,
    },
    services: rows,
  };
}
