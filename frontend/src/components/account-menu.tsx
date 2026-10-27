"use client";

import { ChevronsUpDown, KeyRound, LogOut, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { DropdownMenu } from "radix-ui";
import { logout } from "@/app/login/actions";
import type { Viewer } from "@/lib/viewer";
import { setTheme, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function AccountMenu({ viewer, compact = false }: { viewer: Viewer; compact?: boolean }) {
  const theme = useTheme();
  const name = viewer.displayName || viewer.username;
  const initial = (name || "?").charAt(0).toUpperCase();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn(
          "flex items-center gap-2.5 rounded-[var(--radius-control)] text-left outline-none transition-colors hover:bg-hover data-[state=open]:bg-hover",
          compact ? "p-1" : "w-full p-2",
        )}
        aria-label="Account"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-[13px] font-semibold text-canvas">{initial}</span>
        {!compact && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{name}</span>
              <span className="block truncate text-xs text-ink-muted">{viewer.username}</span>
            </span>
            <ChevronsUpDown className="size-4 text-ink-subtle" strokeWidth={1.75} />
          </>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={compact ? "end" : "start"}
          side={compact ? "bottom" : "top"}
          sideOffset={6}
          className="z-50 min-w-[220px] animate-fade rounded-[var(--radius-control)] border border-line bg-surface p-1 shadow-[var(--shadow-overlay)]"
        >
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium text-ink">{name}</p>
            <p className="truncate text-xs text-ink-muted">{viewer.username}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item
            onSelect={(event) => {
              // Keep the menu open so the switch is visible.
              event.preventDefault();
              setTheme(theme === "dark" ? "light" : "dark");
            }}
            className="flex w-full cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm text-ink outline-none data-[highlighted]:bg-hover"
          >
            {theme === "dark" ? (
              <Sun className="size-4 text-ink-muted" strokeWidth={1.75} />
            ) : (
              <Moon className="size-4 text-ink-muted" strokeWidth={1.75} />
            )}
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link href="/account/password" className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-ink outline-none data-[highlighted]:bg-hover">
              <KeyRound className="size-4 text-ink-muted" strokeWidth={1.75} />
              Change password
            </Link>
          </DropdownMenu.Item>
          <form action={logout}>
            <DropdownMenu.Item asChild>
              <button
                type="submit"
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-ink outline-none data-[highlighted]:bg-hover"
              >
                <LogOut className="size-4 text-ink-muted" strokeWidth={1.75} />
                Sign out
              </button>
            </DropdownMenu.Item>
          </form>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
