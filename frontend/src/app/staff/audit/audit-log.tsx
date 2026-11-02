"use client";

import { Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { EmptyState } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { lettermark } from "../placements/stats";

export type AuditRow = { key: string; at: string; day: string; time: string; college: string; who: string; username: string; what: string; on: string; resource: string; allowed: boolean };

const OUTCOMES = [
  { key: "all", label: "All" },
  { key: "allowed", label: "Allowed" },
  { key: "refused", label: "Refused" },
] as const;

/** The log grouped by day, with a search and an outcome filter over what is loaded. */
export function AuditLog({ rows, several }: { rows: AuditRow[]; several: boolean }) {
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]["key"]>("all");
  const needle = useDeferredValue(query.trim().toLowerCase());
  const shown = useMemo(
    () =>
      rows.filter((row) => (outcome === "all" || (outcome === "allowed") === row.allowed) && (!needle || `${row.who} ${row.username} ${row.what} ${row.college} ${row.resource}`.toLowerCase().includes(needle))),
    [rows, needle, outcome],
  );
  const days = useMemo(() => {
    const groups = new Map<string, AuditRow[]>();
    for (const row of shown) groups.set(row.day, [...(groups.get(row.day) ?? []), row]);
    return [...groups.entries()];
  }, [shown]);
  const refused = rows.filter((row) => !row.allowed).length;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-[var(--radius-surface)] border border-line bg-surface p-2.5">
        <div className="relative min-w-[16rem] flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" strokeWidth={1.75} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search who, what or where"
            aria-label="Search the audit log"
            className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-canvas pl-9 pr-3 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15"
          />
        </div>
        <div role="group" aria-label="Outcome" className="inline-flex rounded-[var(--radius-control)] border border-line bg-sidebar p-0.5 text-[13px]">
          {OUTCOMES.map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-pressed={outcome === entry.key}
              onClick={() => setOutcome(entry.key)}
              className={cn("rounded-[calc(var(--radius-control)-2px)] px-3 py-1 transition-colors", outcome === entry.key ? "bg-surface font-medium text-ink shadow-[var(--shadow-hairline)]" : "text-ink-muted hover:text-ink")}
            >
              {entry.label}
              {entry.key === "refused" && refused > 0 && <span className="ml-1.5 font-mono text-[11px] text-danger">{refused}</span>}
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-xs text-ink-subtle">{shown.length} shown</span>
      </div>

      {days.length === 0 ? (
        <EmptyState>Nothing matches.</EmptyState>
      ) : (
        <div className="space-y-6">
          {days.map(([day, items]) => (
            <section key={day} aria-label={day}>
              <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">{day}</h2>
              <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
                {items.map((row) => (
                  <li key={row.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-hover">
                    <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft font-mono text-[11.5px] font-semibold text-brand-soft-ink">
                      {lettermark(row.who)}
                    </span>
                    <div className="min-w-0 flex-1 basis-64">
                      <p className="text-[13.5px] text-ink">
                        <span className="font-medium">{row.who}</span> <span className="text-ink-muted">{row.what}</span>
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-subtle">
                        {row.username && <span className="font-mono">@{row.username}</span>}
                        {several && <span>{row.college}</span>}
                        <span className="font-mono" title={row.resource}>{row.on}</span>
                      </p>
                    </div>
                    <span className="whitespace-nowrap font-mono text-xs text-ink-muted" title={row.at}>{row.time}</span>
                    <Badge tone={row.allowed ? "success" : "danger"}>{row.allowed ? "Allowed" : "Refused"}</Badge>
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
