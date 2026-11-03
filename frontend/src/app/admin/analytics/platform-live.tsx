"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Tile } from "@/components/staff/tile";
import {
  type RangeKey,
  RANGES,
  type ServiceRow,
  type Series,
  type Snapshot,
  formatBytes,
  formatCores,
  formatCount,
  formatLatency,
  formatRate,
  formatShare,
} from "@/lib/platform-metrics";
import { cn } from "@/lib/utils";
import { SeriesTable, TimeSeries } from "./time-series";

const REFRESH_MS = 10_000;
type Tone = "good" | "warn" | "bad";
const DOT: Record<Tone, string> = { good: "bg-success", warn: "bg-warning", bad: "bg-danger" };

/**
 * The live Platform view: headline figures, charts per service and a service table, all from
 * Prometheus through the server. It refreshes every ten seconds while the tab is visible.
 * `sample` shows the layout with made-up numbers and never calls the server.
 */
export function PlatformLive({ initial, sample = false }: { initial: Snapshot; sample?: boolean }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [range, setRange] = useState<RangeKey>(initial.range);
  const [live, setLive] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const first = useRef(true);

  const load = useCallback(
    async (next: RangeKey) => {
      if (sample) return;
      try {
        const response = await fetch(`/api/platform/metrics?range=${next}`, { cache: "no-store", credentials: "same-origin" });
        if (!response.ok || !response.headers.get("content-type")?.includes("json")) throw new Error("session");
        setSnapshot((await response.json()) as Snapshot);
        setProblem(null);
      } catch {
        setProblem("Could not refresh. If you were signed out, reload the page.");
      }
    },
    [sample],
  );

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void load(range);
  }, [range, load]);

  useEffect(() => {
    if (!live || sample) return;
    const tick = () => {
      if (!document.hidden) void load(range);
    };
    const timer = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [live, range, load, sample]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { stats, charts, services, appMetrics, prometheus } = snapshot;
  const ready = services.filter((row) => row.desired !== null && row.available !== null && row.available >= row.desired && row.desired > 0).length;
  const tracked = services.filter((row) => row.desired !== null).length;
  const age = Math.max(0, Math.round((now - snapshot.generatedAt) / 1000));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Time range" className="inline-flex rounded-[var(--radius-control)] border border-line p-0.5 text-[13px]">
          {(Object.keys(RANGES) as RangeKey[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={range === key}
              onClick={() => setRange(key)}
              className={cn("rounded-[calc(var(--radius-control)-2px)] px-3 py-1 transition-colors", range === key ? "bg-hover font-medium text-ink" : "text-ink-muted hover:text-ink")}
            >
              {RANGES[key].label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={live}
          onClick={() => setLive((value) => !value)}
          className="flex h-8 items-center gap-2 rounded-[var(--radius-control)] border border-line px-3 text-[13px] text-ink-muted transition-colors hover:text-ink"
        >
          <span aria-hidden className={cn("size-1.5 rounded-full", live ? "animate-pulse bg-brand" : "bg-ink-subtle")} />
          {live ? "Live" : "Paused"}
        </button>
        <p className="font-mono text-[12px] text-ink-subtle" aria-live="off">
          {sample ? "sample data" : prometheus === "ok" ? `updated ${age}s ago` : ""}
        </p>
      </div>

      {problem && <p role="alert" className="text-sm text-warning">{problem}</p>}
      {prometheus === "unconfigured" && <Notice title="Metrics are not connected">Set PROMETHEUS_URL for the web UI so it can read Prometheus. Nothing here is guessed.</Notice>}
      {prometheus === "unreachable" && <Notice title="Prometheus did not answer">The web UI could not reach Prometheus. It will keep trying while this page is open.</Notice>}
      {prometheus === "ok" && !appMetrics && (
        <Notice title="Request metrics are not being collected yet">
          The services already publish request counts and latency; Prometheus just is not scraping them. They start once the services are redeployed with the new chart. Everything about pods, CPU and memory below is live now.
        </Notice>
      )}

      <section aria-label="Headline figures" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Services ready" value={tracked ? `${ready} of ${tracked}` : "-"} note="every replica available" tone={tracked && ready === tracked ? "good" : tracked ? "bad" : undefined} />
        <Stat label="Pods not ready" value={stats.podsNotReady === null ? "-" : String(Math.round(stats.podsNotReady))} note="in the aethercode namespace" tone={stats.podsNotReady === null ? undefined : stats.podsNotReady === 0 ? "good" : "bad"} />
        <Stat label="Restarts, 24 h" value={stats.restarts24h === null ? "-" : formatCount(stats.restarts24h)} note="containers restarted" tone={stats.restarts24h === null ? undefined : stats.restarts24h === 0 ? "good" : stats.restarts24h < 5 ? "warn" : "bad"} />
        <Stat label="Cluster CPU" value={stats.clusterCpu === null ? "-" : formatShare(stats.clusterCpu)} note="busy across all nodes" tone={load3(stats.clusterCpu)} />
        <Stat label="Cluster memory" value={stats.clusterMemory === null ? "-" : formatShare(stats.clusterMemory)} note="in use across all nodes" tone={load3(stats.clusterMemory)} />
        <Stat label="Requests" value={appMetrics && stats.requestRate !== null ? formatRate(stats.requestRate) : "-"} note={appMetrics ? "to all services, last minute" : "not collected yet"} />
        <Stat label="Server errors" value={appMetrics && stats.errorRate !== null ? formatShare(stats.errorRate) : "-"} note={appMetrics ? "share of requests that were 5xx" : "not collected yet"} tone={appMetrics && stats.errorRate !== null ? (stats.errorRate < 0.01 ? "good" : stats.errorRate < 0.05 ? "warn" : "bad") : undefined} />
        <Stat label="Latency, p95" value={appMetrics && stats.latencyP95 !== null ? formatLatency(stats.latencyP95) : "-"} note={appMetrics ? "slowest 5% of requests" : "not collected yet"} tone={appMetrics && stats.latencyP95 !== null ? (stats.latencyP95 < 0.5 ? "good" : stats.latencyP95 < 2 ? "warn" : "bad") : undefined} />
      </section>

      <div className="grid gap-3 xl:grid-cols-2">
        <Chart label="Requests per second" series={charts.requests} format={formatRate} off={!appMetrics} note="By service." />
        <Chart label="Server errors" series={charts.errors} format={formatShare} off={!appMetrics} note="Share of each service's requests that failed with a 5xx." />
        <Chart label="Latency, p95" series={charts.latency} format={formatLatency} off={!appMetrics} note="Time within which 95% of requests finished." />
        <Chart label="CPU" series={charts.cpu} format={formatCores} note="Cores in use, summed over each service's pods." everyService />
        <Chart label="Memory" series={charts.memory} format={formatBytes} note="Working set, summed over each service's pods." everyService />
        <Chart label="Database connections" series={charts.db} format={(v) => String(Math.round(v))} off={!appMetrics} note="Connections in use from each service's pool." />
        <Chart label="Network" series={charts.network} format={(v) => `${formatBytes(v)}/s`} note="All traffic into and out of the platform's pods." area wide />
      </div>

      <Tile label="Services" className="overflow-x-auto" expand={undefined}>
        <ServiceTable rows={services} appMetrics={appMetrics} />
      </Tile>
    </div>
  );
}

const load3 = (share: number | null): Tone | undefined => (share === null ? undefined : share < 0.7 ? "good" : share < 0.9 ? "warn" : "bad");

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="status" className="rounded-[var(--radius-surface)] border border-dashed border-line-strong px-5 py-4 text-sm">
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 text-ink-muted">{children}</p>
    </div>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: Tone }) {
  return (
    <Tile label={label}>
      <p className="mt-auto flex items-center gap-2.5 text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-ink">
        {tone && <span aria-hidden className={cn("size-2 rounded-full", DOT[tone])} />}
        {value}
      </p>
      <p className="mt-2 truncate text-[12.5px] text-ink-muted">{note}</p>
    </Tile>
  );
}

function Chart({ label, series, format, off = false, note, ceiling, area = false, wide = false, everyService = false }: { label: string; series: Series[]; format: (value: number) => string; off?: boolean; note: string; ceiling?: number; area?: boolean; wide?: boolean; everyService?: boolean }) {
  return (
    <Tile
      label={label}
      className={wide ? "xl:col-span-2" : undefined}
      expand={off || series.length === 0 ? undefined : { title: label, description: note, content: <div className="space-y-5"><TimeSeries series={series} format={format} height={300} ceiling={ceiling} area={area} label={label} shown={everyService ? 12 : undefined} /><SeriesTable series={series} format={format} /></div> }}
    >
      <p className="mb-2 text-[12.5px] text-ink-muted">{note}</p>
      {off ? <p className="grid h-40 place-items-center text-sm text-ink-muted">Not collected yet.</p> : <TimeSeries series={series} format={format} ceiling={ceiling} area={area} label={label} shown={everyService ? 12 : undefined} />}
    </Tile>
  );
}

function ServiceTable({ rows, appMetrics }: { rows: ServiceRow[]; appMetrics: boolean }) {
  const dash = <span className="text-ink-subtle">-</span>;
  return (
    <table className="w-full min-w-[720px] text-[13.5px]">
      <thead className="text-left text-[11px] uppercase tracking-[0.06em] text-ink-subtle">
        <tr>
          <th className="py-2 pr-4 font-medium">Service</th>
          <th className="px-4 py-2 font-medium">Replicas</th>
          <th className="px-4 py-2 font-medium">CPU</th>
          <th className="px-4 py-2 font-medium">Memory</th>
          <th className="px-4 py-2 font-medium">Restarts, 24 h</th>
          <th className="px-4 py-2 font-medium">Requests</th>
          <th className="px-4 py-2 font-medium">Errors</th>
          <th className="py-2 pl-4 font-medium">p95</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const healthy = row.desired !== null && row.available !== null && row.available >= row.desired && row.desired > 0;
          const known = row.desired !== null;
          return (
            <tr key={row.name} className="border-t border-line">
              <td className="py-2 pr-4 text-ink">
                <span aria-hidden className={cn("mr-2 inline-block size-2 rounded-full", !known ? "bg-ink-subtle" : healthy ? "bg-success" : "bg-danger")} />
                {row.name}
                <span className="sr-only">{!known ? ", unknown" : healthy ? ", healthy" : ", not fully available"}</span>
              </td>
              <td className="px-4 py-2 font-mono tabular-nums">{known ? `${row.available ?? 0} / ${row.desired}` : dash}</td>
              <td className="px-4 py-2 font-mono tabular-nums">{row.cpu !== null ? formatCores(row.cpu) : dash}</td>
              <td className="px-4 py-2 font-mono tabular-nums">{row.memory !== null ? formatBytes(row.memory) : dash}</td>
              <td className={cn("px-4 py-2 font-mono tabular-nums", row.restarts !== null && row.restarts > 0 && "text-warning")}>{row.restarts !== null ? Math.round(row.restarts) : dash}</td>
              <td className="px-4 py-2 font-mono tabular-nums">{appMetrics && row.requests !== null ? formatRate(row.requests) : dash}</td>
              <td className={cn("px-4 py-2 font-mono tabular-nums", row.errors !== null && row.errors >= 0.05 && "text-danger")}>{appMetrics && row.errors !== null ? formatShare(row.errors) : dash}</td>
              <td className="py-2 pl-4 font-mono tabular-nums">{appMetrics && row.latency !== null ? formatLatency(row.latency) : dash}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
