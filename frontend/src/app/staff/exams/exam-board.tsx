"use client";

import { ChevronRight, Search, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ExamPeek, examState } from "@/components/staff/exam-peek";
import type { ExamVersion } from "@/lib/api-types";
import { useNow } from "@/lib/client/use-now";
import { cn, formatDuration, formatWindow } from "@/lib/utils";

export type BoardExam = { exam: { id: string; created_at: string }; version: ExamVersion | null };

type State = "live" | "next" | "draft" | "closed";
type Filter = "all" | State;

const GROUPS: { state: State; label: string }[] = [
  { state: "live", label: "Live now" },
  { state: "next", label: "Scheduled" },
  { state: "draft", label: "Drafts" },
  { state: "closed", label: "Closed" },
];

/** "in 2 d 4 h", "3 h ago": the nearest two units, enough to plan by. */
function relative(target: number, now: number): string {
  const minutes = Math.round(Math.abs(target - now) / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const text = days ? `${days} d${hours ? ` ${hours} h` : ""}` : hours ? `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${Math.max(minutes, 1)} min`;
  return target > now ? `in ${text}` : `${text} ago`;
}

function stateOf(entry: BoardExam, now: number): State {
  return entry.version ? examState(entry.version, now) : "draft";
}

/** Order inside a group: what needs attention soonest first. */
function compare(state: State) {
  return (a: BoardExam, b: BoardExam) => {
    const at = (entry: BoardExam, key: "opens_at" | "closes_at") => Date.parse(entry.version?.[key] ?? entry.exam.created_at);
    if (state === "live") return at(a, "closes_at") - at(b, "closes_at");
    if (state === "next") return at(a, "opens_at") - at(b, "opens_at");
    if (state === "closed") return at(b, "closes_at") - at(a, "closes_at");
    return Date.parse(b.exam.created_at) - Date.parse(a.exam.created_at);
  };
}

export function ExamBoard({ exams, renderedAt }: { exams: BoardExam[]; renderedAt: number }) {
  const now = useNow(30_000) ?? renderedAt;
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const matching = exams.filter((entry) => !needle || (entry.version?.title ?? "untitled exam").toLowerCase().includes(needle) || entry.exam.id.startsWith(needle));
  const grouped = Object.fromEntries(GROUPS.map(({ state }) => [state, matching.filter((entry) => stateOf(entry, now) === state).sort(compare(state))])) as Record<State, BoardExam[]>;
  const counts = Object.fromEntries(GROUPS.map(({ state }) => [state, exams.filter((entry) => stateOf(entry, now) === state).length])) as Record<State, number>;
  const shown = GROUPS.filter(({ state }) => (filter === "all" || filter === state) && grouped[state].length > 0);

  const tiles: { key: Filter; label: string; count: number }[] = [{ key: "all", label: "All exams", count: exams.length }, ...GROUPS.map(({ state, label }) => ({ key: state, label, count: counts[state] }))];

  return (
    <>
      <div role="group" aria-label="Filter by state" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => {
          const active = filter === tile.key;
          const live = tile.key === "live" && tile.count > 0;
          return (
            <button
              key={tile.key}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(tile.key)}
              className={cn(
                "flex flex-col items-start rounded-[var(--radius-surface)] border bg-surface px-5 py-4 text-left transition-[border-color,background-color,transform] active:scale-[0.98]",
                active ? "border-ink/60 bg-surface-2" : "border-line hover:border-line-strong",
                tile.key === "all" && "col-span-2 sm:col-span-1",
              )}
            >
              <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">
                {live && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-brand" />}
                {tile.label}
              </span>
              <span className={cn("mt-2 text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums", live ? "text-brand" : "text-ink")}>{tile.count}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" strokeWidth={1.75} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by title or exam ID"
            aria-label="Search exams"
            className="h-10 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface pl-9 pr-9 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-ink-subtle transition-colors hover:bg-hover hover:text-ink">
              <X className="size-3.5" strokeWidth={2} />
            </button>
          )}
        </div>
        <p className="ml-auto shrink-0 font-mono text-[12px] text-ink-subtle" aria-live="polite">
          {shown.reduce((sum, { state }) => sum + grouped[state].length, 0)} shown
        </p>
      </div>

      {shown.length === 0 ? (
        <div className="mt-4 rounded-[var(--radius-surface)] border border-dashed border-line-strong px-6 py-14 text-center text-sm text-ink-muted">
          {exams.length === 0 ? "No exams yet. Create one to get started." : needle ? `Nothing matches "${query.trim()}".` : "No exams in this state."}
        </div>
      ) : (
        <div className="mt-4 space-y-6">
          {shown.map(({ state, label }) => (
            <section key={state} aria-label={label}>
              {filter === "all" && (
                <h2 className="mb-2 flex items-center gap-2 px-1 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">
                  {label}
                  <span className="tabular-nums text-ink-muted">{grouped[state].length}</span>
                </h2>
              )}
              <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
                {grouped[state].map((entry) => (
                  <li key={entry.exam.id}>
                    <Row entry={entry} state={state} now={now} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

const RAIL: Record<State, string> = { live: "bg-brand", next: "bg-ink-muted", draft: "bg-line-strong", closed: "bg-transparent" };

function Row({ entry, state, now }: { entry: BoardExam; state: State; now: number }) {
  const { version } = entry;
  const body = (
    <>
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", RAIL[state])} />
      <span className="min-w-0">
        <span className="block truncate text-[14.5px] font-medium text-ink">{version?.title ?? "Untitled exam"}</span>
        <span className="mt-0.5 block truncate font-mono text-[11.5px] text-ink-subtle">
          {entry.exam.id.slice(0, 8)}
          {version && ` / v${version.version_number} / ${formatDuration(version.duration_seconds)}`}
        </span>
      </span>
      <span className="hidden truncate text-[13px] text-ink-muted md:block">{version ? formatWindow(version.opens_at, version.closes_at) : "No window yet"}</span>
      <span className="hidden md:block">
        <When version={version} state={state} now={now} createdAt={entry.exam.created_at} />
      </span>
      <ChevronRight aria-hidden className="size-4 text-ink-subtle transition-transform group-hover:translate-x-0.5" strokeWidth={1.75} />
    </>
  );
  const layout = "group relative grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 py-3.5 pl-5 pr-4 text-left transition-colors hover:bg-hover md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.3fr)_180px_auto]";
  return version ? (
    <ExamPeek exam={{ exam: entry.exam, version }} now={now} className={layout}>
      {body}
    </ExamPeek>
  ) : (
    <Link href={`/staff/exams/${entry.exam.id}`} className={layout}>
      {body}
    </Link>
  );
}

/** When it matters: time left for live exams (with the window's progress), otherwise how far off it is. */
function When({ version, state, now, createdAt }: { version: ExamVersion | null; state: State; now: number; createdAt: string }) {
  if (!version || state === "draft") return <span className="font-mono text-[12px] text-ink-subtle">created {relative(Date.parse(createdAt), now)}</span>;
  const opens = Date.parse(version.opens_at);
  const closes = Date.parse(version.closes_at);
  if (state === "live") {
    const share = Math.min(1, Math.max(0, (now - opens) / (closes - opens)));
    return (
      <span className="block">
        <span className="block font-mono text-[12px] text-brand">closes {relative(closes, now)}</span>
        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-hover" role="img" aria-label={`${Math.round(share * 100)}% of the window has passed`}>
          <span className="block h-full rounded-full bg-brand" style={{ width: `${share * 100}%` }} />
        </span>
      </span>
    );
  }
  return <span className="font-mono text-[12px] text-ink-muted">{state === "next" ? `opens ${relative(opens, now)}` : `closed ${relative(closes, now)}`}</span>;
}
