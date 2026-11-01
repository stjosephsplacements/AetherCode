import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export type Step = {
  id: string;
  label: string;
  /** One short line under the label, e.g. "3 of 4 tests pass". */
  note?: string;
  state: "done" | "current" | "todo" | "locked";
};

/**
 * The stages of a flow, in order. Done steps are buttons when `onSelect` is
 * given, so an author can go back; the rest only show where they are.
 */
export function Stepper({ steps, onSelect, label = "Progress" }: { steps: Step[]; onSelect?: (id: string) => void; label?: string }) {
  return (
    <ol aria-label={label} className="grid gap-px overflow-hidden rounded-[var(--radius-surface)] border border-line bg-line" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((step, index) => {
        const body = (
          <>
            <span
              aria-hidden
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full font-mono text-[11px] tabular-nums transition-colors",
                step.state === "done" && "bg-success text-canvas",
                step.state === "current" && "bg-brand text-brand-ink",
                (step.state === "todo" || step.state === "locked") && "border border-line-strong text-ink-subtle",
              )}
            >
              {step.state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : step.state === "locked" ? <Lock className="size-3" strokeWidth={2} /> : index + 1}
            </span>
            <span className="min-w-0">
              <span className={cn("block truncate text-[13.5px] font-medium", step.state === "current" ? "text-ink" : step.state === "done" ? "text-ink" : "text-ink-muted")}>{step.label}</span>
              {step.note && <span className="hidden truncate text-[12px] text-ink-muted sm:block">{step.note}</span>}
            </span>
          </>
        );
        const className = cn("flex items-center gap-3 bg-surface px-4 py-3 text-left", step.state === "current" && "bg-surface-2");
        return (
          <li key={step.id} aria-current={step.state === "current" ? "step" : undefined}>
            {step.state === "done" && onSelect ? (
              <button type="button" onClick={() => onSelect(step.id)} className={cn(className, "w-full transition-colors hover:bg-hover")}>
                {body}
              </button>
            ) : (
              <div className={cn(className, "h-full")}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
