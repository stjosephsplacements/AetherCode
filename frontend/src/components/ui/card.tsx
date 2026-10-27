import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A raised surface. Use it only where elevation means something. `glass` lets the ambient glow show through. */
export function Panel({ className, glass = false, ...props }: ComponentProps<"div"> & { glass?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-surface)] border border-line shadow-[var(--shadow-panel)]",
        glass ? "bg-surface/70 backdrop-blur-xl" : "bg-surface",
        className,
      )}
      {...props}
    />
  );
}

const TONES = {
  neutral: "bg-hover text-ink-muted",
  brand: "bg-brand-soft text-brand-soft-ink",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export function Badge({ className, tone = "neutral", ...props }: ComponentProps<"span"> & { tone?: keyof typeof TONES }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
