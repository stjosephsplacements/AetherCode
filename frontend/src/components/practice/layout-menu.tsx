"use client";

import { ArrowCounterClockwise, ArrowsLeftRight, Columns, FrameCorners, Rows, SidebarSimple } from "@phosphor-icons/react/ssr";
import { Popover } from "radix-ui";
import { cn } from "@/lib/utils";
import { DEFAULT_LAYOUT, updateLayout, useLayout } from "./layout-settings";

const choice = (on: boolean) => cn("flex flex-1 flex-col items-center gap-1.5 rounded-xl border p-2.5 text-[11.5px] font-medium transition-colors", on ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line text-ink-muted hover:border-line-strong hover:text-ink");

/** Rearrange the workspace: which side the problem is on, where the console goes, or hide the problem. */
export function LayoutMenu() {
  const layout = useLayout();
  return (
    <Popover.Root>
      <Popover.Trigger aria-label="Layout" className="grid size-8 place-items-center rounded-[var(--radius-control)] text-ink-muted outline-none transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand data-[state=open]:bg-hover">
        <SidebarSimple className="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-[300px] animate-fade space-y-4 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-overlay)]">
          <p className="text-[13px] font-semibold text-ink">Layout</p>
          <div className="space-y-1.5">
            <p className="text-xs text-ink-muted">Problem</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => updateLayout({ swap: false, focus: false })} className={choice(!layout.swap && !layout.focus)}>
                <SidebarSimple className="size-4" />
                Left
              </button>
              <button type="button" onClick={() => updateLayout({ swap: true, focus: false })} className={choice(layout.swap && !layout.focus)}>
                <ArrowsLeftRight className="size-4" />
                Right
              </button>
              <button type="button" onClick={() => updateLayout({ focus: true })} className={choice(layout.focus)}>
                <FrameCorners className="size-4" />
                Hidden
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-ink-muted">Console</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => updateLayout({ console: "bottom" })} className={choice(layout.console === "bottom")}>
                <Rows className="size-4" />
                Below
              </button>
              <button type="button" onClick={() => updateLayout({ console: "right" })} className={choice(layout.console === "right")}>
                <Columns className="size-4" />
                Beside
              </button>
            </div>
          </div>
          <button type="button" onClick={() => updateLayout(DEFAULT_LAYOUT)} className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted hover:text-ink">
            <ArrowCounterClockwise className="size-3.5" />
            Reset layout
          </button>
          <p className="border-t border-line pt-3 text-xs leading-relaxed text-ink-muted">Drag the bars between panes to resize them. Double-click a bar to reset it; arrow keys nudge it.</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
