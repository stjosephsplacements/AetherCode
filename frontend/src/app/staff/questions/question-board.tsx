"use client";

import { ChevronRight, Search, X } from "lucide-react";
import { useState } from "react";
import { Select } from "@/components/staff/form";
import { Tile } from "@/components/staff/tile";
import { Badge } from "@/components/ui/card";
import type { Category } from "@/lib/api-types";
import { type Language, nameOf } from "@/lib/languages";
import { cn } from "@/lib/utils";
import { QuestionPeek } from "./question-peek";

export type QuestionRow = {
  versionId: string;
  title: string;
  slug: string;
  kind: "coding" | "mcq";
  difficulty: "easy" | "medium" | "hard";
  languages: string[];
  sample: number;
  hidden: number;
  options: number;
  categoryId: string;
  categoryName: string;
  tags: string[];
  versionNumber: number;
  prompt: string;
  timeMs: number;
  memoryMb: number;
  audience: "test" | "practice";
  status: "published" | "draft";
  inReview: boolean;
  forYou: boolean;
};

export type Lists = { tests: QuestionRow[]; practice: QuestionRow[]; drafts: QuestionRow[]; review: QuestionRow[] };
export type ListKey = keyof Lists;

const TABS: { key: ListKey; label: string; empty: string }[] = [
  { key: "tests", label: "Tests", empty: "No published test questions yet. Write one and publish it." },
  { key: "practice", label: "Practice", empty: "No practice problems yet. Open a published question and switch it to Practice." },
  { key: "drafts", label: "My drafts", empty: "You have no drafts." },
  { key: "review", label: "To review", empty: "Nothing is waiting for a review." },
];

export function QuestionBoard({ lists, languages, categories, capped, initial }: { lists: Lists; languages: Language[]; categories: Category[]; capped: Partial<Record<ListKey, boolean>>; initial: ListKey }) {
  const [tab, setTab] = useState<ListKey>(initial);
  const [query, setQuery] = useState("");
  const [difficulty, setDifficulty] = useState("all");
  const [category, setCategory] = useState("all");
  const [tag, setTag] = useState("all");
  const [folded, setFolded] = useState<Set<string>>(new Set());

  const needle = query.trim().toLowerCase();
  const base = lists[tab];
  const tagNames = [...new Set(base.flatMap((row) => row.tags))].sort();
  const rows = base.filter(
    (row) =>
      (category === "all" || row.categoryId === category) &&
      (difficulty === "all" || row.difficulty === difficulty) &&
      (tag === "all" || row.tags.includes(tag)) &&
      (!needle || row.title.toLowerCase().includes(needle) || row.slug.includes(needle) || row.tags.some((entry) => entry.includes(needle))),
  );
  // Category, then difficulty inside it. Without categories (an older question bank) there is one group.
  const groups = (categories.length > 0 ? categories : [{ id: "", name: "Questions", question_count: 0 }])
    .map((entry) => ({ ...entry, rows: rows.filter((row) => row.categoryId === entry.id) }))
    .filter((entry) => entry.rows.length > 0);
  const toggle = (id: string) => setFolded((current) => new Set(current.has(id) ? [...current].filter((entry) => entry !== id) : [...current, id]));
  const empty = TABS.find((entry) => entry.key === tab)!.empty;

  return (
    <>
      <div role="group" aria-label="Question lists" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {TABS.map(({ key, label }) => {
          const active = key === tab;
          const urgent = key === "review" && lists.review.length > 0;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => setTab(key)}
              className={cn("flex flex-col items-start rounded-[var(--radius-surface)] border bg-surface px-5 py-4 text-left transition-[border-color,background-color,transform] active:scale-[0.98]", active ? "border-ink/60 bg-surface-2" : "border-line hover:border-line-strong")}
            >
              <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">
                {urgent && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-brand" />}
                {label}
              </span>
              <span className={cn("mt-2 text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums", urgent ? "text-brand" : "text-ink")}>
                {lists[key].length}
                {capped[key] && "+"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" strokeWidth={1.75} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by title or slug"
            aria-label="Search questions"
            className="h-10 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface pl-9 pr-9 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-ink-subtle transition-colors hover:bg-hover hover:text-ink">
              <X className="size-3.5" strokeWidth={2} />
            </button>
          )}
        </div>
        {tagNames.length > 0 && (
          <Select aria-label="Tag" size="sm" className="w-44" value={tag} onValueChange={setTag}>
            <option value="all">Any tag</option>
            {tagNames.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </Select>
        )}
        <Select aria-label="Difficulty" size="sm" className="w-40" value={difficulty} onValueChange={setDifficulty}>
          <option value="all">Any difficulty</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </Select>
        <p className="ml-auto shrink-0 font-mono text-[12px] text-ink-subtle" aria-live="polite">
          {rows.length} shown{capped[tab] && ", latest 100"}
        </p>
      </div>

      <div className="mt-4 grid gap-x-6 gap-y-6 xl:grid-cols-12">
        {categories.length > 0 && (
          <nav aria-label="Categories" className="xl:col-span-3">
            <ul className="space-y-0.5 xl:sticky xl:top-16">
              {[{ id: "all", name: "All categories", total: base.length }, ...categories.map((entry) => ({ id: entry.id, name: entry.name, total: base.filter((row) => row.categoryId === entry.id).length }))].map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    aria-pressed={category === entry.id}
                    onClick={() => setCategory(entry.id)}
                    className={cn(
                      "flex h-9 w-full items-center justify-between gap-3 rounded-[var(--radius-control)] px-3 text-left text-[13.5px] transition-colors",
                      category === entry.id ? "bg-hover font-medium text-ink" : "text-ink-muted hover:bg-hover hover:text-ink",
                      entry.total === 0 && category !== entry.id && "opacity-55",
                    )}
                  >
                    <span className="truncate">{entry.name}</span>
                    <span className="font-mono text-[11.5px] tabular-nums text-ink-subtle">{entry.total}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className={cn("min-w-0", categories.length > 0 ? "xl:col-span-6" : "xl:col-span-8")}>
          {groups.length === 0 ? (
            <div className="rounded-[var(--radius-surface)] border border-dashed border-line-strong px-6 py-14 text-center text-sm text-ink-muted">
              {lists[tab].length === 0 ? empty : needle ? `Nothing matches "${query.trim()}".` : "No question matches those filters."}
            </div>
          ) : (
            <div className="space-y-6">
              {groups.map((group) => {
                const closed = folded.has(group.id);
                return (
                  <section key={group.id || "all"} aria-label={group.name}>
                    {categories.length > 0 && (
                      <button type="button" aria-expanded={!closed} onClick={() => toggle(group.id)} className="mb-2 flex w-full items-center gap-2 text-left">
                        <ChevronRight className={cn("size-4 text-ink-subtle transition-transform duration-200", !closed && "rotate-90")} strokeWidth={1.75} />
                        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{group.name}</h2>
                        <span className="font-mono text-[12px] tabular-nums text-ink-subtle">{group.rows.length}</span>
                      </button>
                    )}
                    {!closed &&
                      (["easy", "medium", "hard"] as const).map((level) => {
                        const inLevel = group.rows.filter((row) => row.difficulty === level);
                        if (inLevel.length === 0) return null;
                        return (
                          <div key={level} className="mb-4 last:mb-0">
                            <h3 className="mb-1.5 flex items-center gap-2 px-1 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">
                              <span aria-hidden className={cn("size-1.5 rounded-full", level === "easy" ? "bg-success" : level === "medium" ? "bg-warning" : "bg-danger")} />
                              {level}
                              <span className="tabular-nums text-ink-muted">{inLevel.length}</span>
                            </h3>
                            <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
                              {inLevel.map((row) => (
                                <li key={row.versionId}>
                                  <QuestionPeek row={row} languages={languages} className="group flex w-full items-center gap-4 px-5 py-3 transition-colors hover:bg-hover">
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-[14.5px] font-medium text-ink">{row.title}</span>
                                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                                        <span className="font-mono text-[11.5px] text-ink-subtle">{row.slug}</span>
                                        {row.tags.slice(0, 4).map((entry) => (
                                          <span key={entry} className="rounded-full bg-hover px-2 py-px text-[11.5px] text-ink-muted">
                                            {entry}
                                          </span>
                                        ))}
                                        {row.tags.length > 4 && <span className="text-[11.5px] text-ink-subtle">+{row.tags.length - 4}</span>}
                                      </span>
                                    </span>
                                    <span className="hidden shrink-0 text-right text-[12.5px] text-ink-muted sm:block">
                                      {row.kind === "mcq" ? `MCQ, ${row.options} options` : `${row.sample} sample, ${row.hidden} hidden`}
                                    </span>
                                    {tab === "review" && row.forYou && <Badge tone="brand">For you</Badge>}
                                    {tab === "drafts" && <Badge>{row.inReview ? "In review" : "Draft"}</Badge>}
                                    {tab === "drafts" && row.kind === "coding" && row.sample + row.hidden === 0 && <Badge tone="warning">No tests</Badge>}
                                    <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5" strokeWidth={1.75} />
                                  </QuestionPeek>
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <div className={cn("space-y-3", categories.length > 0 ? "xl:col-span-3" : "xl:col-span-4")}>
          <Mix label={TABS.find((entry) => entry.key === tab)!.label} rows={lists[tab]} languages={languages} />
          <Attention lists={lists} languages={languages} onOpen={setTab} />
        </div>
      </div>
    </>
  );
}

const RAMP = [
  { key: "easy", fill: "bg-ink/25" },
  { key: "medium", fill: "bg-ink/55" },
  { key: "hard", fill: "bg-ink" },
] as const;

/** The list you are looking at, by difficulty and by language. One neutral ramp, so the bars read by length and shade, not by hue. */
function Mix({ label, rows, languages }: { label: string; rows: QuestionRow[]; languages: Language[] }) {
  const counts = RAMP.map(({ key, fill }) => ({ key, fill, count: rows.filter((row) => row.difficulty === key).length }));
  const coding = rows.filter((row) => row.kind === "coding");
  const perLanguage = new Map<string, number>();
  for (const row of coding) for (const key of row.languages) perLanguage.set(key, (perLanguage.get(key) ?? 0) + 1);
  const top = [...perLanguage].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <Tile label={`${label}, by difficulty`}>
      {rows.length === 0 ? (
        <p className="py-2 text-[13px] text-ink-muted">Nothing here yet.</p>
      ) : (
        <div className="space-y-5">
          <div>
            <div className="flex h-2.5 gap-[2px]" role="img" aria-label={counts.map(({ key, count }) => `${count} ${key}`).join(", ")}>
              {counts.filter(({ count }) => count > 0).map(({ key, fill, count }) => (
                <span key={key} className={cn("h-full rounded-[4px]", fill)} style={{ flex: `${count} 1 0`, minWidth: 4 }} />
              ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-ink-muted">
              {counts.map(({ key, fill, count }) => (
                <li key={key} className="flex items-center gap-1.5 capitalize">
                  <span aria-hidden className={cn("size-2 rounded-[2px]", fill)} />
                  {key}
                  <span className="font-mono tabular-nums text-ink">{count}</span>
                </li>
              ))}
            </ul>
          </div>
          {top.length > 0 && (
            <div>
              <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-subtle">Languages offered</p>
              <ul className="space-y-1.5">
                {top.map(([key, count]) => (
                  <li key={key} className="grid grid-cols-[88px_minmax(0,1fr)_28px] items-center gap-3 text-[12.5px]">
                    <span className="truncate text-ink-muted">{nameOf(languages, key)}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-hover">
                      <span className="block h-full rounded-full bg-brand" style={{ width: `${(count / coding.length) * 100}%` }} />
                    </span>
                    <span className="text-right font-mono tabular-nums text-ink">{count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Tile>
  );
}

/** What is waiting on you, whatever list is open: reviews and drafts with no tests. */
function Attention({ lists, languages, onOpen }: { lists: Lists; languages: Language[]; onOpen: (tab: ListKey) => void }) {
  const forYou = lists.review.filter((row) => row.forYou);
  const untested = lists.drafts.filter((row) => row.kind === "coding" && row.sample + row.hidden === 0);
  const items = [
    ...forYou.map((row) => ({ row, why: "Sent to you for review" })),
    ...untested.map((row) => ({ row, why: "Draft with no tests yet" })),
  ].slice(0, 5);
  return (
    <Tile label="Needs attention">
      {items.length === 0 ? (
        <p className="py-2 text-[13px] text-ink-muted">Nothing is waiting on you.</p>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {items.map(({ row, why }) => (
            <li key={`${row.versionId}-${why}`}>
              <QuestionPeek row={row} languages={languages} className="flex w-full flex-col rounded-[var(--radius-control)] px-2 py-2 transition-colors hover:bg-hover">
                <span className="truncate text-[13.5px] font-medium text-ink">{row.title}</span>
                <span className="text-[12px] text-warning">{why}</span>
              </QuestionPeek>
            </li>
          ))}
        </ul>
      )}
      {(forYou.length > 0 || lists.review.length > 0) && (
        <button type="button" onClick={() => onOpen("review")} className="mt-3 text-left text-[12.5px] text-ink-muted transition-colors hover:text-ink">
          {lists.review.length} waiting for review in total
        </button>
      )}
    </Tile>
  );
}
