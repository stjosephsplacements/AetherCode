"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * A drag handle between two panes. It reports the new size of the first pane as a percentage of the
 * container, by pointer or with the arrow keys; double-click resets.
 */
export function Splitter({ direction, container, onChange, onReset, label }: { direction: "horizontal" | "vertical"; container: React.RefObject<HTMLElement | null>; onChange: (percent: number) => void; onReset: () => void; label: string }) {
  const dragging = useRef(false);
  const horizontal = direction === "horizontal";
  const measure = (event: { clientX: number; clientY: number }) => {
    const box = container.current?.getBoundingClientRect();
    if (!box) return;
    const raw = horizontal ? ((event.clientX - box.left) / box.width) * 100 : ((event.clientY - box.top) / box.height) * 100;
    onChange(Math.min(80, Math.max(20, Math.round(raw * 10) / 10)));
  };
  return (
    <div
      role="separator"
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      aria-label={label}
      tabIndex={0}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => dragging.current && measure(event)}
      onPointerUp={() => (dragging.current = false)}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 5 : 1;
        const box = container.current?.getBoundingClientRect();
        if (!box) return;
        const less = horizontal ? "ArrowLeft" : "ArrowUp";
        const more = horizontal ? "ArrowRight" : "ArrowDown";
        if (event.key !== less && event.key !== more) return;
        event.preventDefault();
        // The handle sits between panes, so its position tells the current size.
        const here = event.currentTarget.getBoundingClientRect();
        const percent = horizontal ? ((here.left + here.width / 2 - box.left) / box.width) * 100 : ((here.top + here.height / 2 - box.top) / box.height) * 100;
        onChange(Math.min(80, Math.max(20, percent + (event.key === more ? step : -step))));
      }}
      className={cn("group relative z-10 shrink-0 touch-none outline-none", horizontal ? "hidden w-2 cursor-col-resize lg:block" : "h-2 cursor-row-resize")}
    >
      <span className={cn("absolute rounded-full bg-line-strong transition-colors group-hover:bg-brand group-focus-visible:bg-brand group-active:bg-brand", horizontal ? "inset-y-2 left-1/2 w-[3px] -translate-x-1/2" : "inset-x-2 top-1/2 h-[3px] -translate-y-1/2")} />
    </div>
  );
}
