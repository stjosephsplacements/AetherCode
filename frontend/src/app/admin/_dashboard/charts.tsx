"use client";

import {
  Bar,
  BarChart as ReBarChart,
  Cell,
  Pie,
  PieChart as RePieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { panel } from "@/app/admin/_dashboard/panel";
import { cn } from "@/lib/utils";

export { panel };

type Tone = "brand" | "success" | "warning" | "danger" | "muted";
type BarRow = { label: string; value: number; tone?: Tone };
type Slice = { label: string; value: number; tone?: Tone };

const TONE: Record<Tone, string> = {
  brand: "var(--brand)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  muted: "var(--line-strong)",
};

const FILL: Record<Tone, string> = {
  brand: "bg-brand",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  muted: "bg-line-strong",
};

const tip = {
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
  cursor: { fill: "var(--hover)" },
} as const;

function ChartFrame({
  title,
  note,
  empty,
  className,
  isEmpty,
  children,
}: {
  title: string;
  note?: string;
  empty: string;
  className?: string;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className={cn(panel, className)}>
      <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">{title}</h2>
      {note && <p className="mt-1 text-[12.5px] text-ink-muted">{note}</p>}
      {isEmpty ? <p className="mt-auto py-6 text-sm text-ink-muted">{empty}</p> : children}
    </section>
  );
}

/** Horizontal bars for ranks and queue depth. */
export function BarChart({ title, note, bars, empty, className }: { title: string; note?: string; bars: BarRow[]; empty: string; className?: string }) {
  const max = Math.max(...bars.map((bar) => bar.value), 0);
  return (
    <ChartFrame title={title} note={note} empty={empty} className={className} isEmpty={bars.length === 0 || max === 0}>
      <div className="mt-4 h-[min(220px,calc(2.25rem*var(--chart-rows,4)+1rem))] min-h-[7.5rem] flex-1" style={{ "--chart-rows": bars.length } as React.CSSProperties}>
        <ResponsiveContainer width="100%" height="100%">
          <ReBarChart data={bars} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
            <XAxis type="number" hide domain={[0, max]} />
            <YAxis
              type="category"
              dataKey="label"
              width={88}
              tick={{ fill: "var(--ink-muted)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip {...tip} formatter={(value) => [String(value), ""]} />
            <Bar dataKey="value" radius={[0, tokenPx("--radius-pill"), tokenPx("--radius-pill"), 0]} barSize={10} background={{ fill: "var(--hover)", radius: tokenPx("--radius-pill") }}>
              {bars.map((bar) => (
                <Cell key={bar.label} fill={TONE[bar.tone ?? "brand"]} />
              ))}
            </Bar>
          </ReBarChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}

/** Vertical columns for latency and throughput. */
export function ColumnChart({
  title,
  note,
  columns,
  empty,
  unit,
  className,
}: {
  title: string;
  note?: string;
  columns: BarRow[];
  empty: string;
  /** Serializable suffix for tooltips (e.g. "ms"). Functions cannot cross the server→client boundary. */
  unit?: string;
  className?: string;
}) {
  const max = Math.max(...columns.map((column) => column.value), 0);
  const label = (value: number) => (unit ? `${value} ${unit}` : String(value));
  return (
    <ChartFrame title={title} note={note} empty={empty} className={className} isEmpty={columns.length === 0 || max === 0}>
      <div className="mt-4 h-44 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ReBarChart data={columns} margin={{ top: 16, right: 8, left: 0, bottom: 4 }}>
            <XAxis dataKey="label" tick={{ fill: "var(--ink-muted)", fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
            <YAxis hide domain={[0, max * 1.1 || 1]} />
            <Tooltip {...tip} formatter={(value) => [label(Number(value)), ""]} />
            <Bar dataKey="value" radius={[tokenPx("--radius-control"), tokenPx("--radius-control"), 0, 0]} maxBarSize={28}>
              {columns.map((column) => (
                <Cell key={column.label} fill={TONE[column.tone ?? "brand"]} />
              ))}
            </Bar>
          </ReBarChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}

function tokenPx(name: "--radius-control" | "--radius-pill" | "--radius-chip"): number {
  if (typeof window === "undefined") {
    if (name === "--radius-pill") return 9999;
    if (name === "--radius-chip") return 8;
    return 12;
  }
  const n = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  return Number.isFinite(n) ? n : name === "--radius-pill" ? 9999 : name === "--radius-chip" ? 8 : 12;
}

/** Donut with a centre figure. */
export function DonutChart({
  title,
  note,
  slices,
  centre,
  centreNote,
  empty,
  className,
}: {
  title: string;
  note?: string;
  slices: Slice[];
  centre: string;
  centreNote?: string;
  empty: string;
  className?: string;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  return (
    <ChartFrame title={title} note={note} empty={empty} className={className} isEmpty={total === 0}>
      <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-5 sm:flex-row sm:justify-between">
        <div className="relative size-[9rem] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <RePieChart>
              <Pie data={slices} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="88%" paddingAngle={2} stroke="none">
                {slices.map((slice) => (
                  <Cell key={slice.label} fill={TONE[slice.tone ?? "brand"]} />
                ))}
              </Pie>
              <Tooltip {...tip} />
            </RePieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="font-mono text-[22px] font-semibold tabular-nums leading-none text-ink">{centre}</p>
              {centreNote && <p className="mt-1 text-[11px] text-ink-muted">{centreNote}</p>}
            </div>
          </div>
        </div>
        <ul className="w-full space-y-2 sm:w-auto sm:min-w-[140px]">
          {slices.map((slice) => (
            <li key={slice.label} className="flex items-center justify-between gap-4 text-[13px]">
              <span className="flex items-center gap-2 text-ink">
                <span aria-hidden className={cn("size-2 rounded-pill", FILL[slice.tone ?? "brand"])} />
                {slice.label}
              </span>
              <span className="font-mono tabular-nums text-ink-muted">{slice.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </ChartFrame>
  );
}

/** Compact sparkline-style histogram. */
export function SparkBars({
  title,
  note,
  values,
  empty,
  className,
}: {
  title: string;
  note?: string;
  values: { label: string; value: number }[];
  empty: string;
  className?: string;
}) {
  return (
    <ChartFrame title={title} note={note} empty={empty} className={className} isEmpty={values.length === 0}>
      <div className="mt-4 h-28 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ReBarChart data={values} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
            <Tooltip {...tip} />
            <Bar dataKey="value" fill="var(--brand)" fillOpacity={0.85} radius={[tokenPx("--radius-control"), tokenPx("--radius-control"), 0, 0]} maxBarSize={18} />
          </ReBarChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}

/** Segmented readiness strip for gateway services. */
export function ServiceStrip({ title, ready, total, rows, className }: { title: string; ready: number; total: number; rows: { name: string; ready: boolean; ms: number }[]; className?: string }) {
  return (
    <section aria-label={title} className={cn(panel, className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">{title}</h2>
        <p className="font-mono text-[12.5px] tabular-nums text-ink">
          {ready}/{total} ready
        </p>
      </div>
      <div className="mt-4 flex h-2.5 overflow-hidden rounded-pill bg-hover" role="img" aria-label={`${ready} of ${total} services ready`}>
        {total > 0 && (
          <>
            <span className="bg-success" style={{ width: `${(ready / total) * 100}%` }} />
            <span className="bg-danger" style={{ width: `${((total - ready) / total) * 100}%` }} />
          </>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="mt-auto py-6 text-sm text-ink-muted">No service health yet.</p>
      ) : (
        <ul className="mt-5 divide-y divide-line border-t border-line">
          {rows.map((row) => (
            <li key={row.name} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
              <span className="flex items-center gap-2 text-ink">
                <span aria-hidden className={cn("size-1.5 rounded-pill", row.ready ? "bg-success" : "bg-danger")} />
                {row.name}
              </span>
              <span className="font-mono text-[12px] tabular-nums text-ink-muted">{row.ms} ms</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Stacked floor for live exams: writing / handed in / not started. */
export function FloorChart({
  title,
  note,
  rows,
  empty,
  className,
}: {
  title: string;
  note?: string;
  rows: { id: string; label: string; writing: number; handedIn: number; waiting: number }[];
  empty: string;
  className?: string;
}) {
  const data = rows.map((row) => ({
    label: row.label,
    writing: row.writing,
    handedIn: row.handedIn,
    waiting: row.waiting,
    total: row.writing + row.handedIn + row.waiting,
  }));
  return (
    <ChartFrame title={title} note={note} empty={empty} className={className} isEmpty={rows.length === 0}>
      <div className="mt-4 h-[min(240px,calc(2.75rem*var(--chart-rows,3)+2rem))] min-h-[9rem] flex-1" style={{ "--chart-rows": rows.length } as React.CSSProperties}>
        <ResponsiveContainer width="100%" height="100%">
          <ReBarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }} stackOffset="expand">
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="label" width={120} tick={{ fill: "var(--ink)", fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip {...tip} />
            <Bar dataKey="handedIn" stackId="floor" fill="var(--ink)" radius={[tokenPx("--radius-pill"), 0, 0, tokenPx("--radius-pill")]} barSize={10} />
            <Bar dataKey="writing" stackId="floor" fill="var(--brand)" barSize={10} />
            <Bar dataKey="waiting" stackId="floor" fill="var(--line-strong)" radius={[0, tokenPx("--radius-pill"), tokenPx("--radius-pill"), 0]} barSize={10} />
          </ReBarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-auto flex flex-wrap gap-4 pt-4 text-[11.5px] text-ink-subtle">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-pill bg-brand" /> writing
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-pill bg-ink" /> handed in
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-pill bg-line-strong" /> not started
        </span>
      </p>
    </ChartFrame>
  );
}

/** Metric tile used in the bento headline row. */
export function FigureCard({ label, value, note, tone, className }: { label: string; value: string; note: string; tone?: "good" | "warn" | "bad"; className?: string }) {
  return (
    <div className={cn(panel, className)}>
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">{label}</p>
      <p className="mt-3 flex items-center gap-2 font-mono text-[2rem] font-semibold leading-none tracking-[-0.03em] tabular-nums text-ink">
        {tone && <span aria-hidden className={cn("size-2 rounded-pill", tone === "good" ? "bg-success" : tone === "warn" ? "bg-warning" : "bg-danger")} />}
        {value}
      </p>
      <p className="mt-2 text-[12.5px] text-ink-muted">{note}</p>
    </div>
  );
}
