"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountMenu } from "@/components/account-menu";
import { type NavGroup, SidebarCollapse, StaffNav } from "@/components/staff/staff-nav";
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

/**
 * Floating console sidebar: rounded panel inset from the canvas edge.
 * Text labels when expanded; glyph rail when collapsed. Ctrl/Cmd+B toggles width.
 */
export function StaffSidebar({
  viewer,
  groups,
  brand,
  college,
  initiallyCollapsed,
  home = "/staff",
  consoleLabel,
}: {
  home?: string;
  consoleLabel?: string;
  viewer: Viewer;
  groups: NavGroup[];
  brand: React.ReactNode;
  college?: React.ReactNode;
  initiallyCollapsed: boolean;
}) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const toggle = () =>
    setCollapsed((current) => {
      remember(!current);
      return !current;
    });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key?.toLowerCase() !== "b" || !(event.metaKey || event.ctrlKey)) return;
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

  return (
    <aside
      data-collapsed={collapsed || undefined}
      className={cn(
        "z-30 hidden h-full shrink-0 flex-col overflow-hidden rounded-panel border border-line bg-sidebar shadow-[var(--shadow-panel)] transition-[width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] lg:flex print:hidden",
        collapsed ? "w-[var(--sidebar-collapsed)]" : "w-[var(--sidebar-expanded)]",
      )}
    >
      <div className={cn("flex h-[var(--shell-header)] shrink-0 items-center border-b border-line", collapsed ? "justify-center px-1" : "gap-2 pl-4 pr-2")}>
        {!collapsed && (
          <Link href={home} className="min-w-0 flex-1 truncate">
            {brand}
          </Link>
        )}
        <SidebarCollapse collapsed={collapsed} onToggle={toggle} />
      </div>

      {!collapsed && consoleLabel && (
        <div className="border-b border-line px-4 py-2.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-subtle">{consoleLabel}</p>
        </div>
      )}

      {college && !collapsed && <div className="border-b border-line px-3 py-3">{college}</div>}

      <nav aria-label="Main" className={cn("flex-1 overflow-y-auto overflow-x-hidden py-4", collapsed ? "px-2" : "px-2.5")}>
        <StaffNav groups={groups} collapsed={collapsed} />
      </nav>

      <div className={cn("mt-auto border-t border-line", collapsed ? "flex justify-center p-2" : "p-2.5")}>
        <AccountMenu viewer={viewer} compact={collapsed} />
      </div>
    </aside>
  );
}
