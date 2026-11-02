"use client";

import { Search } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { type HelpSection, MORE_HELP, STUDENT_HELP } from "@/content/help";
import { cn } from "@/lib/utils";

const ALL: HelpSection[] = [...MORE_HELP.filter((section) => section.audience === "students"), ...STUDENT_HELP, ...MORE_HELP.filter((section) => section.audience === "staff")];

export function HelpCenter() {
  const [query, setQuery] = useState("");
  const [audience, setAudience] = useState<"students" | "staff">("students");
  const deferred = useDeferredValue(query.trim().toLowerCase());

  const sections = ALL.filter((section) => section.audience === audience)
    .map((section) => ({
      ...section,
      entries: deferred
        ? section.entries.filter((entry) => `${section.title} ${entry.question}`.toLowerCase().includes(deferred))
        : section.entries,
    }))
    .filter((section) => section.entries.length > 0);
  const count = sections.reduce((total, section) => total + section.entries.length, 0);

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search help</span>
          <Search aria-hidden className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="> search, for example “Safe Exam Browser” or “timer”"
            className="h-12 w-full border border-ink bg-surface pl-11 pr-4 font-mono text-[14px] text-ink shadow-[3px_3px_0_var(--ink)] outline-none transition-shadow placeholder:text-ink-subtle focus:shadow-[3px_3px_0_var(--brand)]"
          />
        </label>
        <div role="group" aria-label="Who is asking" className="flex border border-ink font-mono text-[13.5px]">
          {(["students", "staff"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={audience === value}
              onClick={() => setAudience(value)}
              className={cn(
                "h-11 border-l border-ink px-4 transition-colors first:border-l-0",
                audience === value ? "bg-brand text-brand-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              [{value}]
            </button>
          ))}
        </div>
      </div>
      <p aria-live="polite" className="mt-3 text-[13px] text-ink-subtle">
        {deferred ? `${count} ${count === 1 ? "answer" : "answers"} for “${query.trim()}”` : " "}
      </p>

      {sections.length === 0 ? (
        <div className="mt-8 border border-dashed border-ink px-6 py-12 text-center font-mono">
          <p className="text-[15px] text-ink">(o_o)? no answers match that.</p>
          <p className="mt-1 text-sm text-ink-muted">Try a shorter word, or ask your invigilator or exam administrator.</p>
        </div>
      ) : (
        sections.map((section) => (
          <section key={section.title} className="mt-8">
            <h2 className="mb-3 font-mono text-[12.5px] text-ink-subtle">[ {section.title.toLowerCase()} ]</h2>
            <div className="overflow-hidden border border-ink bg-surface shadow-[4px_4px_0_var(--ink)]">
              {section.entries.map((entry, index) => (
                <details key={entry.question} open={Boolean(deferred)} className={cn("group", index > 0 && "border-t border-line")}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[15px] font-medium text-ink transition-colors hover:text-brand [&::-webkit-details-marker]:hidden">
                    {entry.question}
                    <span aria-hidden className="shrink-0 font-mono text-[13px] text-brand"><span className="group-open:hidden">[+]</span><span className="hidden group-open:inline">[-]</span></span>
                  </summary>
                  <div className="px-5 pb-5 text-[14.5px] leading-relaxed text-ink-muted">{entry.answer}</div>
                </details>
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
