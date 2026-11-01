import { Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type Expand = { title: string; description?: string; content: React.ReactNode };

/**
 * One bento tile. Its label sits top-left; when there is more than fits, the
 * corner button opens the whole of it in a modal instead of another page.
 */
export function Tile({ label, expand, live = false, className, children }: { label: string; expand?: Expand; live?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={label}
      className={cn(
        "flex min-w-0 flex-col rounded-[var(--radius-surface)] border bg-surface p-5",
        live ? "border-brand/40 bg-[linear-gradient(to_bottom_right,var(--brand-soft),transparent_45%),var(--surface)]" : "border-line",
        className,
      )}
    >
      <div className="mb-3 flex h-6 items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">
          {live && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-brand" />}
          {label}
        </h2>
        {expand && (
          <Dialog>
            <DialogTrigger
              aria-label={`Expand ${label.toLowerCase()}`}
              className="-mr-1.5 grid size-7 place-items-center rounded-[var(--radius-control)] text-ink-subtle transition-[color,background-color,transform] hover:bg-hover hover:text-ink active:scale-[0.97]"
            >
              <Maximize2 className="size-3.5" strokeWidth={1.75} />
            </DialogTrigger>
            <DialogContent title={expand.title} description={expand.description} className="w-[min(94vw,880px)]">
              <div className="min-h-0 overflow-y-auto p-6">{expand.content}</div>
            </DialogContent>
          </Dialog>
        )}
      </div>
      {children}
    </section>
  );
}
