"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { percent } from "@/lib/analytics";
import { PASS_SHARE } from "@/lib/results";
import { cn } from "@/lib/utils";

export type StudentRow = { candidate: string; roll: string; exams: number; average: number; college?: string };

/** Every student ranked by average, searchable by roll number, for the tile's modal. */
export function StudentList({ rows, several }: { rows: StudentRow[]; several: boolean }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = rows.filter((row) => !needle || row.roll.toLowerCase().includes(needle) || (row.college ?? "").toLowerCase().includes(needle));
  return (
    <div>
      <div className="relative mb-3 max-w-sm">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" strokeWidth={1.75} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by roll number"
          aria-label="Search students"
          className="h-9 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface pl-9 pr-3 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15"
        />
      </div>
      <p className="mb-2 font-mono text-[12px] text-ink-subtle" aria-live="polite">
        {shown.length} of {rows.length}
      </p>
      <ol className="divide-y divide-line overflow-hidden rounded-[var(--radius-surface)] border border-line">
        {shown.slice(0, 200).map((row, index) => (
          <li key={row.candidate} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto_5rem] items-center gap-3 px-4 py-2 text-[13.5px]">
            <span className="font-mono tabular-nums text-ink-subtle">{index + 1}</span>
            <span className="min-w-0 truncate">
              <span className="font-mono text-ink">{row.roll}</span>
              {several && row.college && <span className="ml-2 text-ink-muted">{row.college}</span>}
            </span>
            <span className="font-mono text-[12px] tabular-nums text-ink-subtle">{row.exams} exam{row.exams === 1 ? "" : "s"}</span>
            <span className={cn("text-right font-mono tabular-nums", row.average >= PASS_SHARE ? "text-ink" : "text-danger")}>{percent(row.average)}</span>
          </li>
        ))}
      </ol>
      {shown.length > 200 && <p className="mt-2 text-xs text-ink-muted">Showing the first 200. Search to narrow it.</p>}
    </div>
  );
}
