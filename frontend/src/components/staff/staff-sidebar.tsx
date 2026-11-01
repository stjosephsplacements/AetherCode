"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountMenu } from "@/components/account-menu";
import { type NavGroup, StaffNav } from "@/components/staff/staff-nav";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";
import type { Viewer } from "@/lib/viewer";
import { cn } from "@/lib/utils";

function remember(collapsed: boolean) {
  // Remembering it is a functional cookie: only with consent, like the theme.
  try {
    if (JSON.parse(localStorage.getItem("aether-consent") ?? "{}").functional !== true) return;
  } catch {
    return;
  }
  document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
}

/** The console sidebar, folding to an icon rail. Ctrl or Cmd + B toggles it. */
export function StaffSidebar({ viewer, groups, brand, college, initiallyCollapsed }: { viewer: Viewer; groups: NavGroup[]; brand: React.ReactNode; college?: React.ReactNode; initiallyCollapsed: boolean }) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const toggle = () =>
    setCollapsed((current) => {
      remember(!current);
      return !current;
    });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b" || !(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable], .monaco-editor")) return;
      event.preventDefault();
      setCollapsed((current) => {
        remember(!current);
        return !current;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const Toggle = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <aside
      data-collapsed={collapsed || undefined}
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-canvas transition-[width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] lg:flex print:hidden",
        collapsed ? "w-[60px]" : "w-[232px]",
      )}
    >
      <div className={cn("flex h-12 shrink-0 items-center border-b border-line", collapsed ? "justify-center" : "justify-between pl-4 pr-2")}>
        {!collapsed && (
          <Link href="/staff" className="min-w-0 truncate">
            {brand}
          </Link>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={`${collapsed ? "Expand" : "Collapse"} sidebar (Ctrl+B)`}
          className="grid size-8 place-items-center rounded-[var(--radius-control)] text-ink-subtle transition-colors hover:bg-hover hover:text-ink"
        >
          <Toggle className="size-4" strokeWidth={1.75} />
        </button>
      </div>
      {college && !collapsed && <div className="border-b border-line px-3 py-3">{college}</div>}
      <nav aria-label="Main" className={cn("flex-1 overflow-y-auto overflow-x-hidden py-4", collapsed ? "px-2.5" : "px-2")}>
        <StaffNav groups={groups} collapsed={collapsed} />
      </nav>
      <div className={cn("border-t border-line p-2", collapsed && "flex justify-center")}>
        <AccountMenu viewer={viewer} compact={collapsed} />
      </div>
    </aside>
  );
}
