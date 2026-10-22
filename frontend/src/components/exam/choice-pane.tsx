"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/markdown";
import type { PaperItem } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";

/**
 * Answers one multiple-choice question (ADR-0035). Each change saves at once;
 * the server keeps the latest selection and grades it when the test ends.
 */
export function ChoicePane({
  attemptPath,
  item,
  selected,
  readOnly,
  onSaved,
}: {
  attemptPath: string;
  item: PaperItem;
  selected: number[];
  readOnly: boolean;
  onSaved: (selected: number[]) => void;
}) {
  const [saving, setSaving] = useState(false);

  async function choose(index: number) {
    if (readOnly) return;
    const next = item.multiple_choice
      ? selected.includes(index)
        ? selected.filter((value) => value !== index)
        : [...selected, index].sort((a, b) => a - b)
      : selected.includes(index)
        ? []
        : [index];
    const previous = selected;
    onSaved(next);
    setSaving(true);
    try {
      await api(`${attemptPath}/choices/${item.exam_item_id}`, { method: "PUT", body: { selected: next } });
    } catch (error) {
      onSaved(previous);
      toast.error(error instanceof Error ? error.message : "Your answer could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-label="Your answer"
      className="flex min-h-[320px] flex-1 flex-col overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface shadow-[var(--shadow-panel)]"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4 text-[13px]">
        <span className="font-medium text-ink">{item.multiple_choice ? "Choose every correct option" : "Choose one option"}</span>
        <span className="ml-auto flex items-center gap-1.5 text-ink-muted">
          {saving ? (
            <>
              <LoaderCircle className="size-3.5 animate-spin" />
              Saving
            </>
          ) : selected.length > 0 ? (
            <>
              <Check className="size-3.5 text-success" strokeWidth={2.25} />
              Saved
            </>
          ) : (
            "Not answered"
          )}
        </span>
      </div>
      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4" role={item.multiple_choice ? "group" : "radiogroup"}>
        {(item.choices ?? []).map((choice, position) => {
          const checked = selected.includes(choice.index);
          return (
            <li key={choice.index}>
              <button
                type="button"
                role={item.multiple_choice ? "checkbox" : "radio"}
                aria-checked={checked}
                disabled={readOnly}
                onClick={() => choose(choice.index)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-[var(--radius-control)] border px-4 py-3 text-left text-sm transition-colors",
                  checked ? "border-brand bg-brand-soft" : "border-line hover:border-line-strong hover:bg-hover",
                  readOnly && "cursor-not-allowed opacity-70",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-5 shrink-0 place-items-center border text-[11px] font-semibold",
                    item.multiple_choice ? "rounded-[5px]" : "rounded-full",
                    checked ? "border-brand bg-brand text-brand-ink" : "border-line-strong text-ink-muted",
                  )}
                >
                  {checked ? <Check className="size-3" strokeWidth={3} /> : String.fromCharCode(65 + position)}
                </span>
                <Markdown className="min-w-0 flex-1 [&>*:first-child]:mt-0">{choice.text}</Markdown>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="shrink-0 border-t px-4 py-2.5 text-xs text-ink-muted">
        {item.multiple_choice ? "Marks only for exactly the correct set of options." : "Click your option again to clear it."}
      </p>
    </section>
  );
}
