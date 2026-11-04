"use client";

import { MagnifyingGlass } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useState } from "react";
import { Ring } from "@/components/student/ring";
import { cn } from "@/lib/utils";

export type Topic = { name: string; total: number; solved: number; attempted: number; easy: number; medium: number; hard: number };

const TONES = ["bg-brand-soft text-brand", "bg-success-soft text-success", "bg-warning-soft text-warning", "bg-danger-soft text-danger"];
const label = (name: string) => name.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

/** One card per topic: how many problems, how many solved, and the difficulty mix. */
export function TopicGrid({ topics }: { topics: Topic[] }) {
  const [query, setQuery] = useState("");
  const shown = topics.filter((topic) => label(topic.name).toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">Topics</h2>
        <div className="flex items-center gap-3">
          <Link href="/student/practice/topics/all" className="text-[13px] font-medium text-brand hover:underline">
            All problems
          </Link>
          <label className="relative">
            <span className="sr-only">Search topics</span>
            <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search topics" className="h-10 w-56 rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15" />
          </label>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-line-strong px-6 py-14 text-center text-sm text-ink-muted">{topics.length === 0 ? "No practice problems yet. Your faculty adds them here." : "No topic matches."}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {shown.map((topic, index) => (
            <li key={topic.name}>
              <Link href={`/student/practice/topics/${encodeURIComponent(topic.name)}`} className="group flex h-full flex-col rounded-3xl border border-line bg-surface p-5 shadow-[var(--shadow-panel)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-overlay)]">
                <div className="flex items-start justify-between gap-3">
                  <span className={cn("grid size-12 place-items-center rounded-2xl font-mono text-[17px] font-semibold", TONES[index % TONES.length])}>{label(topic.name).slice(0, 2)}</span>
                  <Ring value={topic.solved} max={topic.total} size={48} stroke={5}>
                    <span className="font-mono text-[11px] font-semibold text-ink">{topic.total ? Math.round((topic.solved / topic.total) * 100) : 0}%</span>
                  </Ring>
                </div>
                <h3 className="mt-4 text-[16px] font-semibold tracking-[-0.01em] text-ink group-hover:text-brand">{label(topic.name)}</h3>
                <p className="mt-0.5 text-[13px] text-ink-muted">
                  {topic.solved} of {topic.total} solved{topic.attempted ? ` · ${topic.attempted} in progress` : ""}
                </p>
                <div className="mt-auto flex gap-1.5 pt-4 text-[11.5px] font-medium">
                  {topic.easy > 0 && <span className="rounded-full bg-success-soft px-2 py-0.5 text-success">{topic.easy} easy</span>}
                  {topic.medium > 0 && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-warning">{topic.medium} med</span>}
                  {topic.hard > 0 && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-danger">{topic.hard} hard</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
