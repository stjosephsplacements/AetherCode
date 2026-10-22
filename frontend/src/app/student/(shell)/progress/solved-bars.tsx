import type { PracticeProgress } from "@/lib/api-types";
import { cn } from "@/lib/utils";

const LEVELS = [
  { key: "easy", label: "Easy", bar: "bg-success" },
  { key: "medium", label: "Medium", bar: "bg-warning" },
  { key: "hard", label: "Hard", bar: "bg-danger" },
] as const;

/** Practice problems solved, overall and by difficulty. */
export function SolvedBars({ progress, className }: { progress: PracticeProgress; className?: string }) {
  return (
    <div className={cn("grid gap-6 rounded-[var(--radius-surface)] border border-line bg-surface p-5 sm:grid-cols-[auto_1fr] sm:items-center", className)}>
      <div>
        <p className="font-mono text-[2rem] font-medium leading-none tabular-nums text-ink">
          {progress.solved}
          <span className="text-base text-ink-subtle">/{progress.available}</span>
        </p>
        <p className="mt-1.5 text-[13px] text-ink-muted">problems solved</p>
      </div>
      <div className="space-y-2.5">
        {LEVELS.map((level) => {
          const counts = progress.by_difficulty[level.key];
          if (!counts) return null;
          return (
            <div key={level.key} className="grid grid-cols-[64px_1fr_56px] items-center gap-3 text-[13px]">
              <span className="text-ink-muted">{level.label}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-hover">
                <span className={cn("block h-full rounded-full", level.bar)} style={{ width: `${(counts.solved / Math.max(counts.available, 1)) * 100}%` }} />
              </span>
              <span className="text-right font-mono tabular-nums text-ink">
                {counts.solved}/{counts.available}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
