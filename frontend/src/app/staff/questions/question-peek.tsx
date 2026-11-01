"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Markdown } from "@/components/markdown";
import { ConfirmDelete } from "@/components/staff/confirm-delete";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { type Language, nameOf } from "@/lib/languages";
import { cn } from "@/lib/utils";
import { deleteDraftVersion } from "./actions";
import type { QuestionRow } from "./question-board";

const DIFFICULTY_TONE = { easy: "success", medium: "warning", hard: "danger" } as const;

/** A question at a glance, from the list: its statement and facts, without leaving the page. */
export function QuestionPeek({ row, languages, className, children }: { row: QuestionRow; languages: Language[]; className?: string; children: React.ReactNode }) {
  const facts: [string, string][] = [
    ...(row.categoryName ? ([["Category", row.categoryName]] as [string, string][]) : []),
    ...(row.kind === "mcq"
      ? ([["Type", "Multiple choice"], ["Options", String(row.options)]] as [string, string][])
      : ([
          ["Type", "Coding"],
          ["Languages", row.languages.map((key) => nameOf(languages, key)).join(", ") || "none"],
          ["Tests", `${row.sample} sample, ${row.hidden} hidden`],
          ["Limits", `${row.timeMs / 1000} s, ${row.memoryMb} MB`],
        ] as [string, string][])),
  ];
  return (
    <Dialog>
      <DialogTrigger className={cn("text-left", className)}>{children}</DialogTrigger>
      <DialogContent title={row.title} description={`${row.slug}, version ${row.versionNumber}`} className="w-[min(94vw,760px)]">
        <div className="min-h-0 space-y-5 overflow-y-auto p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={DIFFICULTY_TONE[row.difficulty]}>{row.difficulty}</Badge>
            {row.status !== "published" && <Badge>{row.inReview ? "In review" : "Draft"}</Badge>}
            {row.audience === "practice" && <Badge tone="brand">Practice</Badge>}
            {row.kind === "coding" && row.status === "draft" && row.sample + row.hidden === 0 && <Badge tone="warning">No tests</Badge>}
          </div>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-control)] border border-line bg-line sm:grid-cols-4">
            {facts.map(([term, value]) => (
              <div key={term} className="bg-surface px-4 py-3">
                <dt className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-subtle">{term}</dt>
                <dd className="mt-1 text-sm font-medium text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {row.tags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
              {row.tags.map((entry) => (
                <li key={entry} className="rounded-full bg-hover px-2.5 py-0.5 text-[12.5px] text-ink-muted">
                  {entry}
                </li>
              ))}
            </ul>
          )}
          <div className="max-h-72 overflow-y-auto rounded-[var(--radius-control)] border border-line p-5">
            <Markdown>{row.prompt}</Markdown>
          </div>
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-line px-6 py-4">
          {row.status === "draft" ? (
            <ConfirmDelete
              label="Delete draft"
              title={`Delete ${row.title}?`}
              description="Only this draft goes. A question that was published before cannot be deleted, exams may pin it."
              onConfirm={(reason) => deleteDraftVersion(row.versionId, reason)}
            />
          ) : (
            <span />
          )}
          <Button asChild>
            <Link href={`/staff/questions/${row.versionId}`}>
              {row.status === "published" ? "Open question" : row.kind === "coding" ? "Continue to verify" : "Continue"}
              <ArrowUpRight />
            </Link>
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
