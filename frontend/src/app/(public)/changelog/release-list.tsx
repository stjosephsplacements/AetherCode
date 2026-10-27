"use client";

import { useState } from "react";
import { type ChangeTag, RELEASES } from "@/content/changelog";
import { cn } from "@/lib/utils";

const TAGS: ChangeTag[] = ["Platform", "UI", "Security", "Compilers"];

const dateFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function ReleaseList() {
  const [tag, setTag] = useState<ChangeTag | null>(null);
  const shown = tag ? RELEASES.filter((release) => release.tags.includes(tag)) : RELEASES;
  return (
    <>
      <div role="group" aria-label="Filter by area" className="flex flex-wrap gap-2">
        {[null, ...TAGS].map((value) => (
          <button
            key={value ?? "all"}
            type="button"
            aria-pressed={tag === value}
            onClick={() => setTag(value)}
            className={cn(
              "h-8 rounded-full border px-3.5 text-[13px] transition-colors",
              tag === value ? "border-ink bg-ink text-canvas" : "border-line-strong text-ink-muted hover:text-ink",
            )}
          >
            {value ?? "Everything"}
          </button>
        ))}
      </div>
      <ol className="mt-12 space-y-12 border-l border-line pl-8">
        {shown.map((release) => (
          <li key={release.date} className="relative">
            <span aria-hidden className="absolute -left-[37px] top-2 size-2.5 rounded-full border-2 border-canvas bg-accent ring-1 ring-line-strong" />
            <time dateTime={release.date} className="text-[13px] text-ink-subtle">
              {dateFormat.format(new Date(release.date))}
            </time>
            <h2 className="mt-1 font-serif text-[1.6rem] leading-tight text-ink">{release.title}</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {release.tags.map((value) => (
                <span key={value} className="rounded-full bg-brand-soft px-2.5 py-0.5 text-[12px] text-brand-soft-ink">
                  {value}
                </span>
              ))}
            </div>
            <ul className="mt-4 list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-ink-muted marker:text-ink-subtle">
              {release.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </>
  );
}
