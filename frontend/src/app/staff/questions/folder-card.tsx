import { cn } from "@/lib/utils";

const LEVELS = [
  { key: "easy", dot: "bg-success" },
  { key: "medium", dot: "bg-warning" },
  { key: "hard", dot: "bg-danger" },
] as const;

/**
 * A category as a folder: a tab, a couple of sheets inside, and a front flap that tips open on hover.
 * Opening it shows the questions inside, by difficulty.
 */
export function FolderCard({ name, total, levels, onOpen }: { name: string; total: number; levels: Record<(typeof LEVELS)[number]["key"], number>; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${name}, ${total} ${total === 1 ? "question" : "questions"}. Open folder`}
      className={cn("group relative block h-40 w-full text-left outline-none [perspective:900px]", total === 0 && "opacity-60")}
    >
      <span aria-hidden className="absolute left-0 top-0 h-5 w-24 rounded-t-[10px] border border-b-0 border-line-strong bg-surface-2 transition-colors group-hover:bg-hover" />
      <span aria-hidden className="absolute inset-x-0 bottom-0 top-[18px] rounded-[var(--radius-surface)] rounded-tl-none border border-line-strong bg-surface-2 transition-colors group-hover:bg-hover group-focus-visible:border-brand group-focus-visible:ring-4 group-focus-visible:ring-brand/15" />
      <span
        aria-hidden
        className="absolute inset-x-5 bottom-8 top-6 -rotate-2 rounded-md border border-line bg-surface transition-transform duration-300 ease-out group-hover:-translate-y-2 group-hover:-rotate-3 motion-reduce:transition-none"
      />
      <span
        aria-hidden
        className="absolute inset-x-4 bottom-8 top-7 rotate-1 rounded-md border border-line bg-surface transition-transform duration-300 ease-out group-hover:-translate-y-1 group-hover:rotate-2 motion-reduce:transition-none"
      />
      <span className="absolute inset-x-0 bottom-0 flex h-[68%] origin-bottom flex-col justify-between rounded-[var(--radius-surface)] border border-line-strong bg-surface px-5 py-4 shadow-[var(--shadow-hairline)] transition-transform duration-300 ease-out [transform-style:preserve-3d] group-hover:[transform:rotateX(-9deg)] motion-reduce:transition-none motion-reduce:group-hover:transform-none">
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{name}</span>
          <span className="font-mono text-[12px] tabular-nums text-ink-subtle">{total}</span>
        </span>
        <span className="flex items-center gap-4 text-[12px] text-ink-muted">
          {LEVELS.map(({ key, dot }) => (
            <span key={key} className="flex items-center gap-1.5">
              <span aria-hidden className={cn("size-1.5 rounded-full", dot, levels[key] === 0 && "opacity-30")} />
              <span className="font-mono tabular-nums text-ink">{levels[key]}</span>
            </span>
          ))}
        </span>
      </span>
    </button>
  );
}
