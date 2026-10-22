"use client";

import { CircleCheck, CircleDashed, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/card";
import type { PracticeProblem } from "@/lib/api-types";
import { cn } from "@/lib/utils";

const DIFFICULTY_TONE = { easy: "success", medium: "warning", hard: "danger" } as const;
const STATUSES = [
  { value: "all", label: "All" },
  { value: "todo", label: "To do" },
  { value: "attempted", label: "Attempted" },
  { value: "solved", label: "Solved" },
] as const;

export function PracticeList({ problems }: { problems: PracticeProblem[] }) {
  const [query, setQuery] = useState("");
  const [difficulty, setDifficulty] = useState<"all" | PracticeProblem["difficulty"]>("all");
  const [status, setStatus] = useState<(typeof STATUSES)[number]["value"]>("all");
  const [tag, setTag] = useState("");
  const tags = useMemo(() => [...new Set(problems.flatMap((problem) => problem.tags))].sort(), [problems]);

  const shown = problems.filter((problem) => {
    const text = query.trim().toLowerCase();
    if (text && !problem.title.toLowerCase().includes(text) && !problem.tags.some((name) => name.toLowerCase().includes(text))) return false;
    if (difficulty !== "all" && problem.difficulty !== difficulty) return false;
    if (tag && !problem.tags.includes(tag)) return false;
    if (status === "solved") return problem.solved;
    if (status === "attempted") return problem.attempted && !problem.solved;
    if (status === "todo") return !problem.attempted;
    return true;
  });

  return (
    <>
      <div className="mt-8 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">Search problems</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" strokeWidth={1.75} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by title or topic"
            className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15"
          />
        </label>
        <Select label="Difficulty" value={difficulty} onChange={(value) => setDifficulty(value as typeof difficulty)}
          options={[["all", "Any difficulty"], ["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]]} />
        {tags.length > 0 && <Select label="Topic" value={tag} onChange={setTag} options={[["", "Any topic"], ...tags.map((name) => [name, name] as [string, string])]} />}
      </div>
      <nav aria-label="Status" className="mt-3 flex gap-1.5">
        {STATUSES.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={status === option.value}
            onClick={() => setStatus(option.value)}
            className={cn("rounded-full px-3 py-1 text-[13px]", status === option.value ? "bg-ink text-canvas" : "bg-hover text-ink-muted hover:text-ink")}
          >
            {option.label}
          </button>
        ))}
      </nav>

      {shown.length === 0 ? (
        <p className="mt-6 rounded-[var(--radius-surface)] border border-dashed border-line-strong px-6 py-12 text-center text-sm text-ink-muted">
          {problems.length === 0 ? "No practice problems yet. Your faculty adds them here." : "No problems match these filters."}
        </p>
      ) : (
        <ul className="mt-4 overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
          {shown.map((problem, index) => (
            <li key={problem.question_id} className={cn(index > 0 && "border-t border-line")}>
              <Link href={`/student/practice/${problem.question_id}`} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-hover">
                {problem.solved ? (
                  <CircleCheck className="size-[18px] shrink-0 text-success" strokeWidth={2} aria-label="Solved" />
                ) : (
                  <CircleDashed className={cn("size-[18px] shrink-0", problem.attempted ? "text-warning" : "text-ink-subtle")} strokeWidth={1.75} aria-label={problem.attempted ? "Attempted" : "Not attempted"} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-ink">{problem.title}</p>
                  {problem.tags.length > 0 && <p className="mt-0.5 truncate text-[13px] text-ink-muted">{problem.tags.join(", ")}</p>}
                </div>
                <Badge tone={DIFFICULTY_TONE[problem.difficulty]}>{problem.difficulty}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand/15"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
