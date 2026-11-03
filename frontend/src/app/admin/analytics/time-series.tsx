"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Series } from "@/lib/platform-metrics";
import { cn } from "@/lib/utils";

// Busy services keep one colour everywhere; the rest are grey and told apart by dash and name.
const SLOT: Record<string, number> = { gateway: 1, user: 2, "question-bank": 3, assessment: 4, submission: 5, judge: 6, identity: 7, tenant: 8, in: 1, out: 2 };
const DASH: Record<string, string> = { seb: "6 3", notification: "2 3", analytics: "9 3 2 3", frontend: "1 3" };

export function colorOf(name: string): string {
  const slot = SLOT[name];
  return slot ? `var(--series-${slot})` : "var(--ink-subtle)";
}

const WIDTH_FALLBACK = 640;
const M = { top: 10, right: 10, bottom: 22 };
/** How many series start visible by default; the rest are one click away in the legend. */
const SHOWN = 8;

/** A y-axis maximum with round tick steps: 0.23 becomes 0.25, 1180 becomes 1200. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const exponent = Math.floor(Math.log10(max));
  const base = 10 ** exponent;
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((candidate) => candidate * base >= max) ?? 10;
  return step * base;
}

/** Series names from the one with the highest peak down, so the quiet ones are the ones that start hidden. */
function busiest(series: Series[]): string[] {
  return [...series].sort((a, b) => Math.max(...b.points.map(([, v]) => v)) - Math.max(...a.points.map(([, v]) => v))).map((entry) => entry.name);
}

const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
const clockSeconds = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** Breaks the line where samples are missing, so a restart or a scrape gap is not drawn as a smooth slope. */
function pathOf(points: [number, number][], x: (t: number) => number, y: (v: number) => number, gap: number): string {
  let d = "";
  let previous = -Infinity;
  for (const [t, v] of points) {
    d += `${t - previous > gap ? "M" : "L"}${x(t).toFixed(1)} ${y(v).toFixed(1)}`;
    previous = t;
  }
  return d;
}

/**
 * Lines over time with a hover crosshair that lists every series at that moment.
 * A legend under it hides or shows a series; colour is never the only cue, because
 * the legend and the tooltip name each series.
 */
export function TimeSeries({ series, format, height = 188, area = false, ceiling, label, shown = SHOWN }: { series: Series[]; format: (value: number) => string; height?: number; area?: boolean; ceiling?: number; label: string; shown?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(WIDTH_FALLBACK);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(busiest(series).slice(shown)));
  const [cursor, setCursor] = useState<number | null>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(node);
    setWidth(Math.max(280, Math.round(node.getBoundingClientRect().width)));
    return () => observer.disconnect();
  }, []);

  const visible = useMemo(() => series.filter((entry) => !hidden.has(entry.name)), [series, hidden]);
  const times = visible.flatMap((entry) => entry.points.map(([t]) => t));
  const minT = Math.min(...times, Infinity);
  const maxT = Math.max(...times, -Infinity);
  const maxV = Math.max(...visible.flatMap((entry) => entry.points.map(([, v]) => v)), 0);
  const top = ceiling ?? niceMax(maxV * 1.05);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((share) => share * top);
  const left = Math.max(40, Math.max(...ticks.map((tick) => format(tick).length)) * 6.6 + 16);
  const plotW = width - left - M.right;
  const plotH = height - M.top - M.bottom;
  const x = (t: number) => left + (maxT === minT ? plotW / 2 : ((t - minT) / (maxT - minT)) * plotW);
  const y = (v: number) => M.top + plotH - (Math.min(v, top) / top) * plotH;

  const step = useMemo(() => {
    const gaps = series.flatMap((entry) => entry.points.slice(1).map(([t], index) => t - entry.points[index]![0]));
    return gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]! : 30;
  }, [series]);

  if (series.length === 0) return <div className="grid place-items-center text-sm text-ink-muted" style={{ height }}>No data in this range.</div>;

  const at = cursor === null ? null : cursor;
  const readings =
    at === null
      ? []
      : visible
          .map((entry) => {
            const nearest = entry.points.reduce<[number, number] | null>((best, point) => (best === null || Math.abs(point[0] - at) < Math.abs(best[0] - at) ? point : best), null);
            return nearest && Math.abs(nearest[0] - at) <= step * 2 ? { name: entry.name, value: nearest[1] } : null;
          })
          .filter((reading): reading is { name: string; value: number } => reading !== null)
          .sort((a, b) => b.value - a.value);

  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left - left) / plotW;
    setCursor(ratio < 0 || ratio > 1 ? null : minT + ratio * (maxT - minT));
  };

  const summary = `${label}: ${visible.map((entry) => `${entry.name} now ${format(entry.points.at(-1)![1])}`).join(", ")}`;

  return (
    <div>
      <div ref={host} className="relative">
        <svg width={width} height={height} role="img" aria-label={summary} onPointerMove={move} onPointerLeave={() => setCursor(null)} className="block touch-none select-none">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={left} x2={width - M.right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? "stroke-line-strong" : "stroke-line"} strokeWidth={1} />
              <text x={left - 8} y={y(tick) + 3.5} textAnchor="end" className="fill-ink-subtle font-mono text-[10.5px]">
                {format(tick)}
              </text>
            </g>
          ))}
          {[0, 0.5, 1].map((share) => {
            const t = minT + share * (maxT - minT);
            return (
              <text key={share} x={left + share * plotW} y={height - 5} textAnchor={share === 0 ? "start" : share === 1 ? "end" : "middle"} className="fill-ink-subtle font-mono text-[10.5px]">
                {clock.format(new Date(t * 1000))}
              </text>
            );
          })}
          {visible.map((entry) => {
            const d = pathOf(entry.points, x, y, step * 2.5);
            return (
              <g key={entry.name}>
                {area && visible.length === 1 && <path d={`${d}L${x(entry.points.at(-1)![0])} ${y(0)}L${x(entry.points[0]![0])} ${y(0)}Z`} fill={colorOf(entry.name)} opacity={0.12} />}
                <path d={d} fill="none" stroke={colorOf(entry.name)} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={DASH[entry.name]} />
              </g>
            );
          })}
          {at !== null && readings.length > 0 && <line x1={x(at)} x2={x(at)} y1={M.top} y2={M.top + plotH} className="stroke-ink-muted" strokeWidth={1} strokeDasharray="3 3" />}
          {at !== null &&
            readings.map((reading) => (
              <circle key={reading.name} cx={x(at)} cy={y(reading.value)} r={3.5} fill={colorOf(reading.name)} className="stroke-surface" strokeWidth={2} />
            ))}
        </svg>
        {at !== null && readings.length > 0 && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-40 max-w-64 rounded-md border border-line-strong bg-surface px-2.5 py-2 text-[12.5px] shadow-[var(--shadow-overlay)]"
            style={{ left: x(at) > width * 0.6 ? undefined : x(at) + 12, right: x(at) > width * 0.6 ? width - x(at) + 12 : undefined }}
          >
            <p className="mb-1 font-mono text-[11px] text-ink-subtle">{clockSeconds.format(new Date(at * 1000))}</p>
            <ul className="space-y-0.5">
              {readings.slice(0, 10).map((reading) => (
                <li key={reading.name} className="flex items-center justify-between gap-4">
                  <span className="flex min-w-0 items-center gap-1.5 text-ink-muted">
                    <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: colorOf(reading.name) }} />
                    <span className="truncate">{reading.name}</span>
                  </span>
                  <span className="font-mono tabular-nums text-ink">{format(reading.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {series.length > 1 && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1" aria-label={`${label} series`}>
          {series.map((entry) => {
            const off = hidden.has(entry.name);
            return (
              <li key={entry.name}>
                <button
                  type="button"
                  aria-pressed={!off}
                  onClick={() => setHidden((current) => new Set(off ? [...current].filter((name) => name !== entry.name) : [...current, entry.name]))}
                  className={cn("flex items-center gap-1.5 rounded px-1 py-0.5 text-[12px] transition-colors hover:bg-hover", off ? "text-ink-subtle line-through" : "text-ink-muted")}
                >
                  <span aria-hidden className="h-0.5 w-3.5 rounded-full" style={{ background: off ? "var(--line-strong)" : colorOf(entry.name) }} />
                  {entry.name}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Min, average, peak and latest of each series, for the expanded view and as a text alternative to the chart. */
export function SeriesTable({ series, format }: { series: Series[]; format: (value: number) => string }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-surface)] border border-line">
      <table className="w-full text-[13.5px]">
        <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-[0.06em] text-ink-subtle">
          <tr>
            <th className="px-4 py-2 font-medium">Series</th>
            <th className="px-4 py-2 font-medium">Now</th>
            <th className="px-4 py-2 font-medium">Average</th>
            <th className="px-4 py-2 font-medium">Peak</th>
            <th className="px-4 py-2 font-medium">Lowest</th>
          </tr>
        </thead>
        <tbody>
          {series.map((entry) => {
            const values = entry.points.map(([, v]) => v);
            return (
              <tr key={entry.name} className="border-t border-line">
                <td className="px-4 py-2 text-ink">
                  <span aria-hidden className="mr-2 inline-block size-2 rounded-full" style={{ background: colorOf(entry.name) }} />
                  {entry.name}
                </td>
                <td className="px-4 py-2 font-mono tabular-nums">{format(values.at(-1)!)}</td>
                <td className="px-4 py-2 font-mono tabular-nums">{format(values.reduce((sum, v) => sum + v, 0) / values.length)}</td>
                <td className="px-4 py-2 font-mono tabular-nums">{format(Math.max(...values))}</td>
                <td className="px-4 py-2 font-mono tabular-nums">{format(Math.min(...values))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
