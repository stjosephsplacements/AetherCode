"use client";

import { MagnifyingGlass } from "@phosphor-icons/react/ssr";
import { useDeferredValue, useMemo, useState } from "react";
import { EmptyState } from "@/components/staff/page-header";
import { LocalPager } from "@/components/staff/pager";
import { Badge } from "@/components/ui/card";
import { lettermark } from "@/lib/lettermark";
import { paginate } from "@/lib/paginate";
import { cn } from "@/lib/utils";

export type AuditRow = {
  key: string;
  at: string;
  day: string;
  time: string;
  college: string;
  who: string;
  username: string;
  what: string;
  on: string;
  resource: string;
  allowed: boolean;
};

const OUTCOMES = [
  { key: "all", label: "All" },
  { key: "allowed", label: "Allowed" },
  { key: "refused", label: "Refused" },
] as const;

/** The log grouped by day, with a search and an outcome filter over what is loaded, 25 entries to a page. */
export function AuditLog({ rows, several }: { rows: AuditRow[]; several: boolean }) {
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]["key"]>("all");
  const needle = useDeferredValue(query.trim().toLowerCase());
  const [pageState, setPageState] = useState({ key: "", page: 1 });
  const shown = useMemo(
    () =>
      rows.filter(
        (row) =>
          (outcome === "all" || (outcome === "allowed") === row.allowed) &&
          (!needle || `${row.who} ${row.username} ${row.what} ${row.college} ${row.resource}`.toLowerCase().includes(needle)),
      ),
    [rows, needle, outcome],
  );
  // A new search or outcome starts again at page 1.
  const filterKey = `${needle}\u0000${outcome}`;
  const paged = useMemo(() => paginate(shown, pageState.key === filterKey ? pageState.page : 1), [shown, pageState, filterKey]);
  const days = useMemo(() => {
    const groups = new Map<string, AuditRow[]>();
    for (const row of paged.rows) groups.set(row.day, [...(groups.get(row.day) ?? []), row]);
    return [...groups.entries()];
  }, [paged]);
  const refused = rows.filter((row) => !row.allowed).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <MagnifyingGlass aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search who, what or where"
            aria-label="Search the audit log"
            className="h-9 w-full rounded-control border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15"
          />
        </div>
        <div role="group" aria-label="Outcome" className="inline-flex rounded-control border border-line bg-hover/40 p-0.5 text-[13px]">
          {OUTCOMES.map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-pressed={outcome === entry.key}
              onClick={() => setOutcome(entry.key)}
              className={cn(
                "rounded-chip px-3 py-1.5 transition-colors",
                outcome === entry.key ? "bg-surface font-medium text-ink shadow-[var(--shadow-hairline)]" : "text-ink-muted hover:text-ink",
              )}
            >
              {entry.label}
              {entry.key === "refused" && refused > 0 && <span className="ml-1.5 font-mono text-[11px] text-danger">{refused}</span>}
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-[12px] tabular-nums text-ink-subtle">{shown.length} shown</span>
      </div>

      {days.length === 0 ? (
        <EmptyState>Nothing matches.</EmptyState>
      ) : (
        <div className="space-y-5">
          {days.map(([day, items]) => (
            <section key={day} aria-label={day}>
              <div className="mb-2 flex items-baseline justify-between gap-2 px-0.5">
                <h2 className="text-[13px] font-medium text-ink-muted">{day}</h2>
                <p className="font-mono text-[11.5px] tabular-nums text-ink-subtle">{items.length}</p>
              </div>
              <ul className="divide-y divide-line overflow-hidden rounded-surface border border-line bg-surface shadow-[var(--shadow-panel)]">
                {items.map((row) => (
                  <li key={row.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-hover">
                    <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-control bg-brand-soft font-mono text-[12px] font-semibold text-brand-soft-ink">
                      {lettermark(row.who)}
                    </span>
                    <div className="min-w-0 flex-1 basis-64">
                      <p className="text-[13.5px] text-ink">
                        <span className="font-medium">{row.who}</span> <span className="text-ink-muted">{row.what}</span>
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-subtle">
                        {row.username && <span className="font-mono">@{row.username}</span>}
                        {several && <span>{row.college}</span>}
                        {row.on && (
                          <span className="font-mono" title={row.resource}>
                            {row.on}
                          </span>
                        )}
                      </p>
                    </div>
                    <span className="whitespace-nowrap font-mono text-[12px] tabular-nums text-ink-muted" title={row.at}>
                      {row.time}
                    </span>
                    <Badge tone={row.allowed ? "success" : "danger"}>{row.allowed ? "Allowed" : "Refused"}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <LocalPager meta={paged} onPage={(page) => setPageState({ key: filterKey, page })} noun="entries" />
    </div>
  );
}
