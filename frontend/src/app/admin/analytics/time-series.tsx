"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Series } from "@/lib/platform-metrics";
import { cn } from "@/lib/utils";

// Busy services keep one colour everywhere; the rest are grey and told apart by dash and name.
const SLOT: Record<string, number> = { gateway: 1, user: 2, "question-bank": 3, assessment: 4, submission: 5, judge: 6, identity: 7, tenant: 8, in: 1, out: 2 };
const DASH: Record<string, string> = { seb: "6 3", notification: "2 3", analytics: "9 3 2 3", frontend: "1 3" };

export function colorOf(name: string): string {
  const slot = SLOT[name];
  return slot ? `var(--series-${slot})` : "var(--ink-subtle)";
}

/** How many series start visible by default; the rest are one click away in the legend. */
const SHOWN = 8;

/** Series names from the one with the highest peak down, so the quiet ones are the ones that start hidden. */
function busiest(series: Series[]): string[] {
  return [...series].sort((a, b) => Math.max(...b.points.map(([, v]) => v)) - Math.max(...a.points.map(([, v]) => v))).map((entry) => entry.name);
}

const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
const clockSeconds = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

const tipStyle = {
  contentStyle: {
    background: "var(--surface)",
    border: "1px solid var(--line-strong)",
    borderRadius: "var(--radius-control)",
    boxShadow: "var(--shadow-overlay)",
    color: "var(--ink)",
    fontSize: "12.5px",
  },
  itemStyle: { color: "var(--ink)" },
  labelStyle: { color: "var(--ink-muted)" },
} as const;

/**
 * Lines over time with a hover tooltip. Legend toggles series. Colour is never the only cue.
 * Built on Recharts; points come from Prometheus via the platform snapshot API.
 */
export function TimeSeries({
  series,
  format,
  height = 188,
  area = false,
  ceiling,
  label,
  shown = SHOWN,
}: {
  series: Series[];
  format: (value: number) => string;
  height?: number;
  area?: boolean;
  ceiling?: number;
  label: string;
  shown?: number;
}) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(busiest(series).slice(shown)));
  const visible = useMemo(() => series.filter((entry) => !hidden.has(entry.name)), [series, hidden]);

  const { rows, keys } = useMemo(() => {
    const times = new Set<number>();
    for (const entry of visible) for (const [t] of entry.points) times.add(t);
    const sorted = [...times].sort((a, b) => a - b);
    const byName = new Map(visible.map((entry) => [entry.name, new Map(entry.points)]));
    return {
      keys: visible.map((entry) => entry.name),
      rows: sorted.map((t) => {
        const row: Record<string, number | null> & { t: number } = { t };
        for (const name of byName.keys()) row[name] = byName.get(name)!.get(t) ?? null;
        return row;
      }),
    };
  }, [visible]);

  if (series.length === 0) {
    return (
      <div className="grid place-items-center text-sm text-ink-muted" style={{ height }}>
        No data in this range.
      </div>
    );
  }

  const Chart = area && visible.length === 1 ? AreaChart : LineChart;
  const summary = `${label}: ${visible.map((entry) => `${entry.name} now ${format(entry.points.at(-1)?.[1] ?? 0)}`).join(", ")}`;

  return (
    <div>
      <div role="img" aria-label={summary} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <Chart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(value: number) => clock.format(new Date(value * 1000))}
              tick={{ fill: "var(--ink-subtle)", fontSize: 10.5 }}
              axisLine={{ stroke: "var(--line-strong)" }}
              tickLine={false}
              minTickGap={48}
            />
            <YAxis
              domain={ceiling != null ? [0, ceiling] : [0, "auto"]}
              tickFormatter={(value: number) => format(value)}
              tick={{ fill: "var(--ink-subtle)", fontSize: 10.5 }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip
              {...tipStyle}
              labelFormatter={(value) => clockSeconds.format(new Date(Number(value) * 1000))}
              formatter={(value, name) => [format(Number(value ?? 0)), String(name)]}
            />
            {area && visible.length === 1 ? (
              <Area
                type="monotone"
                dataKey={keys[0]}
                stroke={colorOf(keys[0]!)}
                fill={colorOf(keys[0]!)}
                fillOpacity={0.12}
                strokeWidth={1.75}
                connectNulls={false}
                dot={false}
                activeDot={{ r: 3.5, stroke: "var(--surface)", strokeWidth: 2 }}
              />
            ) : (
              keys.map((name) => (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stroke={colorOf(name)}
                  strokeWidth={1.75}
                  strokeDasharray={DASH[name]}
                  connectNulls={false}
                  dot={false}
                  activeDot={{ r: 3.5, stroke: "var(--surface)", strokeWidth: 2 }}
                />
              ))
            )}
          </Chart>
        </ResponsiveContainer>
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
                  className={cn("flex items-center gap-1.5 rounded-control px-1 py-0.5 text-[12px] transition-colors hover:bg-hover", off ? "text-ink-subtle line-through" : "text-ink-muted")}
                >
                  <span aria-hidden className="h-0.5 w-3.5 rounded-pill" style={{ background: off ? "var(--line-strong)" : colorOf(entry.name) }} />
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
    <div className="overflow-hidden rounded-surface border border-line">
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
                  <span aria-hidden className="mr-2 inline-block size-2 rounded-pill" style={{ background: colorOf(entry.name) }} />
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
