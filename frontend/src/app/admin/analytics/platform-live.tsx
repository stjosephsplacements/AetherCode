"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { panel } from "@/app/admin/_dashboard/panel";
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
    <div className="space-y-6">
      <section className={cn(panel)}>
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Time range" className="inline-flex rounded-control border border-line bg-hover/40 p-0.5 text-[13px]">
            {(Object.keys(RANGES) as RangeKey[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={range === key}
                onClick={() => setRange(key)}
                className={cn("rounded-chip px-3 py-1.5 transition-colors", range === key ? "bg-surface font-medium text-ink shadow-[var(--shadow-hairline)]" : "text-ink-muted hover:text-ink")}
              >
                {RANGES[key].label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={live}
            onClick={() => setLive((value) => !value)}
            className="flex h-9 items-center gap-2 rounded-control border border-line px-3 text-[13px] text-ink-muted transition-colors hover:bg-hover hover:text-ink"
          >
            <span aria-hidden className={cn("size-1.5 rounded-pill", live ? "animate-pulse bg-brand" : "bg-ink-subtle")} />
            {live ? "Live" : "Paused"}
          </button>
          <p className="ml-auto font-mono text-[12px] text-ink-subtle" aria-live="off">
            {sample ? "sample data" : prometheus === "ok" ? `updated ${age}s ago` : prometheus === "unconfigured" ? "prometheus off" : prometheus === "unreachable" ? "prometheus unreachable" : ""}
          </p>
        </div>

        {/* Focal health strip */}
        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 sm:grid-cols-4 xl:grid-cols-8">
          <Stat label="Services ready" value={tracked ? `${ready}/${tracked}` : "—"} note="replicas up" tone={tracked && ready === tracked ? "good" : tracked ? "bad" : undefined} />
          <Stat label="Pods not ready" value={stats.podsNotReady === null ? "—" : String(Math.round(stats.podsNotReady))} note="namespace" tone={stats.podsNotReady === null ? undefined : stats.podsNotReady === 0 ? "good" : "bad"} />
          <Stat label="Restarts, 24 h" value={stats.restarts24h === null ? "—" : formatCount(stats.restarts24h)} note="containers" tone={stats.restarts24h === null ? undefined : stats.restarts24h === 0 ? "good" : stats.restarts24h < 5 ? "warn" : "bad"} />
          <Stat label="Cluster CPU" value={stats.clusterCpu === null ? "—" : formatShare(stats.clusterCpu)} note="all nodes" tone={load3(stats.clusterCpu)} />
          <Stat label="Cluster memory" value={stats.clusterMemory === null ? "—" : formatShare(stats.clusterMemory)} note="all nodes" tone={load3(stats.clusterMemory)} />
          <Stat label="Requests" value={appMetrics && stats.requestRate !== null ? formatRate(stats.requestRate) : "—"} note={appMetrics ? "last minute" : "not collected"} />
          <Stat
            label="Server errors"
            value={appMetrics && stats.errorRate !== null ? formatShare(stats.errorRate) : "—"}
            note={appMetrics ? "5xx share" : "not collected"}
            tone={appMetrics && stats.errorRate !== null ? (stats.errorRate < 0.01 ? "good" : stats.errorRate < 0.05 ? "warn" : "bad") : undefined}
          />
          <Stat
            label="Latency, p95"
            value={appMetrics && stats.latencyP95 !== null ? formatLatency(stats.latencyP95) : "—"}
            note={appMetrics ? "slowest 5%" : "not collected"}
            tone={appMetrics && stats.latencyP95 !== null ? (stats.latencyP95 < 0.5 ? "good" : stats.latencyP95 < 2 ? "warn" : "bad") : undefined}
          />
        </dl>
      </section>

      {problem && (
        <p role="alert" className={cn(panel, "text-sm text-warning")}>
          {problem}
        </p>
      )}
      {prometheus === "unconfigured" && (
        <Notice title="Metrics are not connected">Set PROMETHEUS_URL for the web UI so it can read Prometheus. Nothing here is guessed.</Notice>
      )}
      {prometheus === "unreachable" && (
        <Notice title="Prometheus did not answer">The web UI could not reach Prometheus. It will keep trying while this page is open.</Notice>
      )}
      {prometheus === "ok" && !appMetrics && (
        <Notice title="Request metrics are not being collected yet">
          The services already publish request counts and latency; Prometheus just is not scraping them. They start once the services are redeployed with the new chart. Everything about pods, CPU and memory below is live now.
        </Notice>
      )}

      <section aria-label="Charts">
        <div className="mb-3">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Load and latency</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">Per-service series for the selected range. Expand a tile for the full table.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Chart label="Requests per second" series={charts.requests} format={formatRate} off={!appMetrics} note="By service." />
          <Chart label="Server errors" series={charts.errors} format={formatShare} off={!appMetrics} note="Share of each service's requests that failed with a 5xx." />
          <Chart label="Latency, p95" series={charts.latency} format={formatLatency} off={!appMetrics} note="Time within which 95% of requests finished." />
          <Chart label="CPU" series={charts.cpu} format={formatCores} note="Cores in use, summed over each service's pods." everyService />
          <Chart label="Memory" series={charts.memory} format={formatBytes} note="Working set, summed over each service's pods." everyService />
          <Chart label="Database connections" series={charts.db} format={(value) => String(Math.round(value))} off={!appMetrics} note="Connections in use from each service's pool." />
          <Chart label="Network" series={charts.network} format={(value) => `${formatBytes(value)}/s`} note="All traffic into and out of the platform's pods." area className="lg:col-span-2" />
        </div>
      </section>

      <section aria-label="Services">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Services</h2>
            <p className="mt-0.5 text-[13px] text-ink-muted">Replica health and load for every tracked deployment.</p>
          </div>
          <p className="font-mono text-[12px] tabular-nums text-ink-subtle">
            {ready}/{tracked || services.length} ready
          </p>
        </div>
        <div className="overflow-x-auto rounded-surface border border-line bg-surface shadow-[var(--shadow-panel)]">
          <div className="p-4">
            <ServiceTable rows={services} appMetrics={appMetrics} />
          </div>
        </div>
      </section>
    </div>
  );
}

const load3 = (share: number | null): Tone | undefined => (share === null ? undefined : share < 0.7 ? "good" : share < 0.9 ? "warn" : "bad");

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="status" className={cn(panel, "border-dashed")}>
      <p className="text-[14px] font-medium text-ink">{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{children}</p>
    </div>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: Tone }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-1.5 font-mono text-[18px] font-semibold tabular-nums tracking-[-0.02em] text-ink">
        {tone && <span aria-hidden className={cn("size-1.5 rounded-pill", DOT[tone])} />}
        {value}
      </dd>
      <p className="mt-0.5 truncate text-[11.5px] text-ink-subtle">{note}</p>
    </div>
  );
}

function Chart({
  label,
  series,
  format,
  off = false,
  note,
  ceiling,
  area = false,
  everyService = false,
  className,
}: {
  label: string;
  series: Series[];
  format: (value: number) => string;
  off?: boolean;
  note: string;
  ceiling?: number;
  area?: boolean;
  everyService?: boolean;
  className?: string;
}) {
  return (
    <Tile
      label={label}
      className={className}
      expand={
        off || series.length === 0
          ? undefined
          : {
              title: label,
              description: note,
              content: (
                <div className="space-y-5">
                  <TimeSeries series={series} format={format} height={300} ceiling={ceiling} area={area} label={label} shown={everyService ? 12 : undefined} />
                  <SeriesTable series={series} format={format} />
                </div>
              ),
            }
      }
    >
      <p className="mb-3 text-[12.5px] text-ink-muted">{note}</p>
      {off ? <p className="grid h-40 place-items-center text-sm text-ink-muted">Not collected yet.</p> : <TimeSeries series={series} format={format} ceiling={ceiling} area={area} label={label} shown={everyService ? 12 : undefined} />}
    </Tile>
  );
}

function ServiceTable({ rows, appMetrics }: { rows: ServiceRow[]; appMetrics: boolean }) {
  const dash = <span className="text-ink-subtle">—</span>;
  if (rows.length === 0) {
    return <p className="py-6 text-sm text-ink-muted">No service rows yet.</p>;
  }
  return (
    <table className="w-full min-w-[720px] text-[13.5px]">
      <thead className="text-left font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">
        <tr className="border-b border-line">
          <th className="py-2.5 pr-4 font-normal">Service</th>
          <th className="px-4 py-2.5 font-normal">Replicas</th>
          <th className="px-4 py-2.5 font-normal">CPU</th>
          <th className="px-4 py-2.5 font-normal">Memory</th>
          <th className="px-4 py-2.5 font-normal">Restarts, 24 h</th>
          <th className="px-4 py-2.5 font-normal">Requests</th>
          <th className="px-4 py-2.5 font-normal">Errors</th>
          <th className="py-2.5 pl-4 font-normal">p95</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const healthy = row.desired !== null && row.available !== null && row.available >= row.desired && row.desired > 0;
          const known = row.desired !== null;
          return (
            <tr key={row.name} className="border-t border-line transition-colors hover:bg-hover/50">
              <td className="py-2.5 pr-4 text-ink">
                <span aria-hidden className={cn("mr-2 inline-block size-2 rounded-pill", !known ? "bg-ink-subtle" : healthy ? "bg-success" : "bg-danger")} />
                {row.name}
                <span className="sr-only">{!known ? ", unknown" : healthy ? ", healthy" : ", not fully available"}</span>
              </td>
              <td className="px-4 py-2.5 font-mono tabular-nums">{known ? `${row.available ?? 0} / ${row.desired}` : dash}</td>
              <td className="px-4 py-2.5 font-mono tabular-nums">{row.cpu !== null ? formatCores(row.cpu) : dash}</td>
              <td className="px-4 py-2.5 font-mono tabular-nums">{row.memory !== null ? formatBytes(row.memory) : dash}</td>
              <td className={cn("px-4 py-2.5 font-mono tabular-nums", row.restarts !== null && row.restarts > 0 && "text-warning")}>{row.restarts !== null ? Math.round(row.restarts) : dash}</td>
              <td className="px-4 py-2.5 font-mono tabular-nums">{appMetrics && row.requests !== null ? formatRate(row.requests) : dash}</td>
              <td className={cn("px-4 py-2.5 font-mono tabular-nums", row.errors !== null && row.errors >= 0.05 && "text-danger")}>{appMetrics && row.errors !== null ? formatShare(row.errors) : dash}</td>
              <td className="py-2.5 pl-4 font-mono tabular-nums">{appMetrics && row.latency !== null ? formatLatency(row.latency) : dash}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
