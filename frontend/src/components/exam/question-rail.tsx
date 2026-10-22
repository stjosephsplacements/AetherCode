"use client";

import { Tooltip } from "radix-ui";
import type { PaperItem } from "@/lib/api-types";
import { cn } from "@/lib/utils";

export type QuestionStatus =
  | { kind: "empty" }
  | { kind: "saved" }
  /** A submission is being judged; best is the best score so far, if any. */
  | { kind: "judging"; best: number | null; maximum: number }
  | { kind: "submitted"; best: number; maximum: number };

export function statusLabel(status: QuestionStatus): string {
  switch (status.kind) {
    case "empty":
      return "Not attempted";
    case "saved":
      return "Code saved, not submitted";
    case "judging":
      return status.best === null
        ? "Submission being judged"
        : `Best ${formatScore(status.best)} of ${formatScore(status.maximum)}, newer submission being judged`;
    case "submitted":
      return `Submitted, best ${formatScore(status.best)} of ${formatScore(status.maximum)}`;
  }
}

export function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, "");
}

/** HackerRank-style side navigator: one numbered button per question. */
export function QuestionRail({
  items,
  currentId,
  statuses,
  onSelect,
}: {
  items: PaperItem[];
  currentId: string;
  statuses: Record<string, QuestionStatus>;
  onSelect: (itemId: string) => void;
}) {
  return (
    <Tooltip.Provider delayDuration={200}>
      <nav aria-label="Questions" className="flex shrink-0 gap-1.5 overflow-x-auto lg:w-14 lg:flex-col lg:items-center lg:overflow-visible lg:py-1">
        {items.map((item, index) => {
          const status = statuses[item.exam_item_id] ?? { kind: "empty" };
          const current = item.exam_item_id === currentId;
          return (
            <Tooltip.Root key={item.exam_item_id}>
              <Tooltip.Trigger asChild>
                <button
                  onClick={() => onSelect(item.exam_item_id)}
                  aria-current={current ? "step" : undefined}
                  aria-label={`Question ${index + 1}: ${statusLabel(status)}`}
                  className={cn(
                    "relative grid size-10 shrink-0 place-items-center rounded-[var(--radius-control)] text-sm font-semibold tabular-nums transition-colors",
                    current ? "bg-ink text-canvas" : "text-ink-muted hover:bg-hover hover:text-ink",
                    !current && (status.kind === "submitted" || (status.kind === "judging" && status.best !== null)) && "bg-success-soft text-success",
                    !current && status.kind === "saved" && "bg-hover text-ink",
                  )}
                >
                  {index + 1}
                  <StatusMark status={status} current={current} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  side="right"
                  sideOffset={8}
                  className="z-50 max-w-[240px] animate-fade rounded-md bg-ink px-2.5 py-1.5 text-xs text-canvas shadow-[var(--shadow-overlay)]"
                >
                  <span className="font-medium">{item.title}</span>
                  <br />
                  {statusLabel(status)}
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          );
        })}
      </nav>
    </Tooltip.Provider>
  );
}

function StatusMark({ status, current }: { status: QuestionStatus; current: boolean }) {
  if (status.kind === "empty") return null;
  return (
    <span
      aria-hidden
      className={cn(
        "absolute right-1 top-1 size-1.5 rounded-full",
        status.kind === "submitted" && "bg-success",
        status.kind === "saved" && (current ? "bg-canvas/70" : "bg-ink-subtle"),
        status.kind === "judging" && "animate-pulse bg-warning",
      )}
    />
  );
}
