"use client";

import { MagnifyingGlass } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { Badge } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { lettermark } from "@/lib/lettermark";

export type Person = { principalId: string; collegeId: string; collegeName: string; name: string; labels: string[]; href: string };

/** The staff you can give permissions to: searchable, the chosen one marked. */
export function PeopleList({ people, chosen, showCollege }: { people: Person[]; chosen: { principalId: string; collegeId: string } | null; showCollege: boolean }) {
  const [query, setQuery] = useState("");
  const needle = useDeferredValue(query.trim().toLowerCase());
  const shown = needle ? people.filter((person) => `${person.name} ${person.collegeName} ${person.labels.join(" ")}`.toLowerCase().includes(needle)) : people;
  return (
    <div className="overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface xl:sticky xl:top-16">
      <div className="relative border-b border-line p-2.5">
        <MagnifyingGlass aria-hidden className="pointer-events-none absolute left-5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${people.length} staff`}
          aria-label="Search staff"
          className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-canvas pl-8 pr-3 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15"
        />
      </div>
      <ul className="max-h-[68vh] divide-y divide-line overflow-y-auto" aria-label="Staff">
        {shown.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-muted">No one matches.</li>}
        {shown.map((person) => {
          const current = chosen?.principalId === person.principalId && chosen.collegeId === person.collegeId;
          return (
            <li key={`${person.collegeId}-${person.principalId}`}>
              <Link href={person.href} aria-current={current ? "page" : undefined} className={cn("flex items-center gap-3 px-3 py-2.5 transition-colors", current ? "bg-hover" : "hover:bg-hover")}>
                <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft font-mono text-[11.5px] font-semibold text-brand-soft-ink">
                  {lettermark(person.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-[13.5px]", current ? "font-medium text-ink" : "text-ink-muted")}>{person.name}</span>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {person.labels.map((label) => (
                      <Badge key={label} tone="neutral" className="text-[10.5px]">{label}</Badge>
                    ))}
                    {showCollege && <span className="truncate text-[11px] text-ink-subtle">{person.collegeName}</span>}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
