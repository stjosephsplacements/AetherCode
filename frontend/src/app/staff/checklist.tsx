import { Check, Lock } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type ChecklistStep = { key: string; title: string; text: string; href: string; done: boolean; blocked?: string };

/** The setup steps in the order they must be done; the first unfinished one is the one to do now. */
export function Checklist({ steps, onNavigate }: { steps: ChecklistStep[]; onNavigate?: () => void }) {
  const current = steps.find((step) => !step.done && !step.blocked)?.key;
  return (
    <ol className="space-y-2">
      {steps.map((step, index) => {
        const now = step.key === current;
        const body = (
          <>
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-medium",
                step.done ? "border-transparent bg-brand text-brand-ink" : now ? "border-brand text-brand" : "border-line-strong text-ink-subtle",
              )}
            >
              {step.done ? <Check className="size-3.5" strokeWidth={2.5} /> : step.blocked ? <Lock className="size-3" /> : index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sm font-medium", step.blocked ? "text-ink-subtle" : "text-ink")}>{step.title}</span>
              <span className="block text-[13px] text-ink-muted">{step.blocked ?? step.text}</span>
            </span>
            {now && <span className="rounded-full bg-brand px-2.5 py-0.5 text-xs font-medium text-brand-ink">Do this next</span>}
          </>
        );
        const box = cn("flex items-center gap-3 rounded-[var(--radius-control)] border px-3 py-2.5", now ? "border-brand/50 bg-hover" : "border-line");
        return (
          <li key={step.key}>
            {step.blocked ? (
              <div aria-disabled="true" className={cn(box, "cursor-not-allowed")}>
                {body}
              </div>
            ) : (
              <Link href={step.href} onClick={onNavigate} className={cn(box, "transition-colors hover:bg-hover")}>
                {body}
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}
