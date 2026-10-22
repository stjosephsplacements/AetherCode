"use client";

import { CircleCheck, CircleDashed, Code2, LoaderCircle } from "lucide-react";
import { AlertDialog } from "radix-ui";
import { Button } from "@/components/ui/button";
import type { PaperItem } from "@/lib/api-types";
import { cn } from "@/lib/utils";
import { type QuestionStatus, statusLabel } from "./question-rail";

/** HackerRank's End Test: a summary of every question, then a confirmation. */
export function EndTestDialog({
  items,
  statuses,
  ending,
  onEnd,
}: {
  items: PaperItem[];
  statuses: Record<string, QuestionStatus>;
  ending: boolean;
  onEnd: () => void;
}) {
  const counts = { submitted: 0, saved: 0, empty: 0 };
  for (const item of items) {
    const kind = statuses[item.exam_item_id]?.kind ?? "empty";
    if (kind === "submitted" || kind === "judging") counts.submitted++;
    else if (kind === "saved") counts.saved++;
    else counts.empty++;
  }
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <Button size="sm" variant="secondary" disabled={ending} className="border-danger/40 text-danger hover:bg-danger-soft">
          {ending && <LoaderCircle className="animate-spin" />}
          End test
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 animate-fade bg-[rgb(20_20_19/0.45)]" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-[460px] -translate-x-1/2 -translate-y-1/2 animate-enter flex-col rounded-[var(--radius-surface)] border border-line bg-surface shadow-[var(--shadow-overlay)]">
          <div className="p-6 pb-4">
            <AlertDialog.Title className="display text-[1.5rem] text-ink">End your test?</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm leading-relaxed text-ink-muted">
              {counts.submitted} submitted, {counts.saved} saved but not submitted, {counts.empty} not attempted. Saved code is evaluated
              when you end, and each question keeps its best score. You can’t come back after this.
            </AlertDialog.Description>
          </div>
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-6">
            {items.map((item, index) => {
              const status = statuses[item.exam_item_id] ?? ({ kind: "empty" } as QuestionStatus);
              return (
                <li key={item.exam_item_id} className="flex items-center gap-3 rounded-[var(--radius-control)] bg-canvas px-3 py-2.5">
                  <span className="w-5 text-center text-[13px] font-semibold tabular-nums text-ink-muted">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{item.title}</span>
                    <span
                      className={cn(
                        "block text-xs",
                        status.kind === "submitted" || (status.kind === "judging" && status.best !== null)
                          ? "text-success"
                          : status.kind === "empty"
                            ? "text-ink-subtle"
                            : "text-ink-muted",
                      )}
                    >
                      {statusLabel(status)}
                    </span>
                  </span>
                  {status.kind === "submitted" || (status.kind === "judging" && status.best !== null) ? (
                    <CircleCheck className="size-4 text-success" strokeWidth={2} />
                  ) : status.kind === "empty" ? (
                    <CircleDashed className="size-4 text-ink-subtle" strokeWidth={1.75} />
                  ) : (
                    <Code2 className="size-4 text-ink-muted" strokeWidth={1.75} />
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex justify-end gap-2 p-6 pt-5">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Keep working</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button onClick={onEnd}>End test</Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
