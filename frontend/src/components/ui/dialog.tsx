"use client";

import { X } from "@phosphor-icons/react/ssr";
import { Dialog as Primitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;

/** Full-viewport liquid-glass frost behind every modal and sheet. */
function Overlay() {
  return <Primitive.Overlay className="dialog-scrim fixed inset-0 z-50 animate-fade" />;
}

/** A centred modal. Radix handles Esc, focus trapping and returning focus. */
export function DialogContent({
  title,
  description,
  eyebrow,
  icon,
  className,
  children,
  ...props
}: ComponentProps<typeof Primitive.Content> & {
  title: string;
  description?: ReactNode;
  /** Small mono label above the title (bento chrome). */
  eyebrow?: string;
  icon?: ReactNode;
}) {
  return (
    <Primitive.Portal>
      <Overlay />
      <Primitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex max-h-[min(88dvh,820px)] w-[min(92vw,640px)] -translate-x-1/2 -translate-y-1/2 animate-pop flex-col overflow-hidden outline-none",
          "rounded-panel border border-line-strong bg-surface shadow-[var(--shadow-overlay)]",
          className,
        )}
        {...props}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="flex min-w-0 items-start gap-3">
            {icon && (
              <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-control bg-brand/15 text-brand" aria-hidden>
                {icon}
              </span>
            )}
            <div className="min-w-0">
              {eyebrow && <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-subtle">{eyebrow}</p>}
              <Primitive.Title className={cn("text-[16px] font-semibold tracking-[-0.02em] text-ink", eyebrow && "mt-1")}>{title}</Primitive.Title>
              {description ? (
                <Primitive.Description className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{description}</Primitive.Description>
              ) : (
                <Primitive.Description className="sr-only">{title}</Primitive.Description>
              )}
            </div>
          </div>
          <Primitive.Close
            aria-label="Close"
            className="-mr-1.5 grid size-8 shrink-0 place-items-center rounded-control text-ink-muted transition-colors hover:bg-hover hover:text-ink"
          >
            <X className="size-4" />
          </Primitive.Close>
        </header>
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}

/** A panel that slides in from the right, for details beside a list. */
export function SheetContent({
  title,
  description,
  className,
  children,
  ...props
}: ComponentProps<typeof Primitive.Content> & { title: string; description?: ReactNode }) {
  return (
    <Primitive.Portal>
      <Overlay />
      <Primitive.Content
        className={cn(
          "fixed inset-y-[var(--shell-gap)] right-[var(--shell-gap)] z-50 flex h-[calc(100dvh-2*var(--shell-gap))] w-[min(100vw,560px)] flex-col overflow-hidden rounded-panel border border-line-strong bg-surface shadow-[var(--shadow-overlay)] outline-none",
          "data-[state=open]:animate-[sheet-in_240ms_cubic-bezier(0.16,1,0.3,1)]",
          className,
        )}
        {...props}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <Primitive.Title className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</Primitive.Title>
            {description ? (
              <Primitive.Description className="mt-1 text-[13px] leading-relaxed text-ink-muted">{description}</Primitive.Description>
            ) : (
              <Primitive.Description className="sr-only">{title}</Primitive.Description>
            )}
          </div>
          <Primitive.Close
            aria-label="Close"
            className="-mr-1.5 grid size-8 shrink-0 place-items-center rounded-control text-ink-muted transition-colors hover:bg-hover hover:text-ink"
          >
            <X className="size-4" />
          </Primitive.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </Primitive.Content>
    </Primitive.Portal>
  );
}
