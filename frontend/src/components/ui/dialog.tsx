"use client";

import { X } from "lucide-react";
import { Dialog as Primitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;

function Overlay() {
  return <Primitive.Overlay className="fixed inset-0 z-50 animate-fade bg-black/60 backdrop-blur-[2px]" />;
}

/** A centred modal. Radix handles Esc, focus trapping and returning focus. */
export function DialogContent({
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
          "fixed left-1/2 top-1/2 z-50 flex max-h-[min(88dvh,820px)] w-[min(92vw,640px)] -translate-x-1/2 -translate-y-1/2 animate-pop flex-col",
          "rounded-[var(--radius-surface)] border border-line-strong bg-surface shadow-[var(--shadow-overlay)] outline-none",
          className,
        )}
        {...props}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <Primitive.Title className="text-[15px] font-semibold text-ink">{title}</Primitive.Title>
            {description ? (
              <Primitive.Description className="mt-0.5 text-[13px] text-ink-muted">{description}</Primitive.Description>
            ) : (
              <Primitive.Description className="sr-only">{title}</Primitive.Description>
            )}
          </div>
          <Primitive.Close
            aria-label="Close"
            className="-mr-2 grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] text-ink-muted transition-colors hover:bg-hover hover:text-ink"
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
          "fixed inset-y-0 right-0 z-50 flex w-[min(100vw,560px)] flex-col border-l border-line-strong bg-surface shadow-[var(--shadow-overlay)] outline-none",
          "data-[state=open]:animate-[sheet-in_240ms_cubic-bezier(0.16,1,0.3,1)]",
          className,
        )}
        {...props}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <Primitive.Title className="text-[15px] font-semibold text-ink">{title}</Primitive.Title>
            {description ? (
              <Primitive.Description className="mt-0.5 text-[13px] text-ink-muted">{description}</Primitive.Description>
            ) : (
              <Primitive.Description className="sr-only">{title}</Primitive.Description>
            )}
          </div>
          <Primitive.Close
            aria-label="Close"
            className="-mr-2 grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] text-ink-muted transition-colors hover:bg-hover hover:text-ink"
          >
            <X className="size-4" />
          </Primitive.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </Primitive.Content>
    </Primitive.Portal>
  );
}
