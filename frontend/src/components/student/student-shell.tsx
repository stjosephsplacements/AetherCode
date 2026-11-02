"use client";

import { ChevronDown, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { useState, useTransition } from "react";
import { logout } from "@/app/login/actions";
import { Brand } from "@/components/brand";
import { ICONS } from "@/components/nav-links";
import { Dialog, DialogTrigger, SheetContent } from "@/components/ui/dialog";
import { accentStyle } from "@/lib/branding";
import { setTheme, useTheme } from "@/lib/theme";
import type { Brand as CollegeBrand } from "@/lib/server/branding";
import { cn } from "@/lib/utils";
import type { Viewer } from "@/lib/viewer";

type Item = { href: string; label: string; icon: keyof typeof ICONS };
type Entry = Item | { label: string; items: Item[] };

/** The student's whole app in one bar: a few places up front, the rest grouped under menus. */
const NAV: Entry[] = [
  { href: "/student", label: "Dashboard", icon: "home" },
  {
    label: "Exams",
    items: [
      { href: "/student/exams", label: "My exams", icon: "exams" },
      { href: "/student/scheduled", label: "Scheduled", icon: "calendar" },
      { href: "/student/completed", label: "Completed", icon: "audit" },
    ],
  },
  { href: "/student/practice", label: "Practice", icon: "practice" },
  { href: "/student/performance", label: "Performance", icon: "progress" },
  {
    label: "Career",
    items: [
      { href: "/student/interviews", label: "Interviews", icon: "interviews" },
      { href: "/student/contests", label: "Contests", icon: "contests" },
      { href: "/student/hackathons", label: "Hackathons", icon: "hackathons" },
      { href: "/student/open-source", label: "Open source", icon: "opensource" },
      { href: "/student/blogs", label: "Blogs", icon: "blogs" },
    ],
  },
  {
    label: "Me",
    items: [
      { href: "/student/tasks", label: "My tasks", icon: "tasks" },
      { href: "/student/profile", label: "My profile", icon: "profile" },
      { href: "/student/resume", label: "My resume", icon: "resume" },
      { href: "/student/help", label: "Help", icon: "help" },
    ],
  },
];

const isGroup = (entry: Entry): entry is { label: string; items: Item[] } => "items" in entry;
const active = (pathname: string, href: string) => (href === "/student" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

/** One cell of the menu bar, as on the landing page: hairline-split, inverts on hover. */
const cell = "flex h-full items-center gap-1.5 border-r border-line px-3.5 text-ink-muted outline-none transition-colors hover:bg-brand hover:text-brand-ink focus-visible:bg-brand focus-visible:text-brand-ink data-[state=open]:bg-brand data-[state=open]:text-brand-ink";
const cellOn = "text-ink";

function Desktop() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="hidden h-full lg:flex">
      {NAV.map((entry) => {
        const on = isGroup(entry) ? entry.items.some((item) => active(pathname, item.href)) : active(pathname, entry.href);
        const label = (
          <>
            {on && <span className="text-brand">&gt;</span>}
            {entry.label.toLowerCase()}
          </>
        );
        return isGroup(entry) ? (
          <DropdownMenu.Root key={entry.label}>
            <DropdownMenu.Trigger className={cn(cell, on && cellOn)}>
              {label}
              <ChevronDown className="size-3" strokeWidth={1.75} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="start" sideOffset={0} className="skin z-50 min-w-[210px] animate-fade border border-ink bg-surface font-mono text-[13px] shadow-[4px_4px_0_var(--ink)]">
                {entry.items.map((item) => (
                  <DropdownMenu.Item key={item.href} asChild>
                    <Link
                      href={item.href}
                      aria-current={active(pathname, item.href) ? "page" : undefined}
                      className={cn("block border-b border-line px-4 py-2.5 outline-none last:border-b-0 data-[highlighted]:bg-brand data-[highlighted]:text-brand-ink", active(pathname, item.href) ? "text-ink" : "text-ink-muted")}
                    >
                      {active(pathname, item.href) && <span className="text-brand">&gt;&nbsp;</span>}
                      {item.label.toLowerCase()}
                    </Link>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : (
          <Link key={entry.href} href={entry.href} aria-current={on ? "page" : undefined} className={cn(cell, on && cellOn)}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Theme, change password and sign out, as a bracketed name on the right of the bar. */
function Account({ viewer }: { viewer: Viewer }) {
  const theme = useTheme();
  const [signingOut, startSignOut] = useTransition();
  const name = (viewer.displayName || viewer.username).split(" ")[0]!.toLowerCase();
  const item = "block w-full border-b border-line px-4 py-2.5 text-left outline-none last:border-b-0 data-[highlighted]:bg-brand data-[highlighted]:text-brand-ink";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger aria-label="Account" className={cn(cell, "border-l border-r-0")}>
        [{name}]
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={0} className="skin z-50 min-w-[210px] animate-fade border border-ink bg-surface font-mono text-[13px] shadow-[4px_4px_0_var(--ink)]">
          <div className="border-b border-line px-4 py-2.5">
            <p className="truncate text-ink">{viewer.displayName || viewer.username}</p>
            <p className="truncate text-[12px] text-ink-subtle">@{viewer.username}</p>
          </div>
          <DropdownMenu.Item
            onSelect={(event) => {
              event.preventDefault();
              setTheme(theme === "dark" ? "light" : "dark");
            }}
            className={cn(item, "cursor-default text-ink-muted")}
          >
            {theme === "dark" ? "light theme" : "dark theme"}
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link href="/account/password" className={cn(item, "text-ink-muted")}>
              change password
            </Link>
          </DropdownMenu.Item>
          {/* Called directly: a form inside the menu unmounts with it before it can submit. */}
          <DropdownMenu.Item disabled={signingOut} onSelect={() => startSignOut(() => logout())} className={cn(item, "cursor-default text-ink-muted data-[disabled]:opacity-60")}>
            {signingOut ? "signing out" : "sign out"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Mobile() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger aria-label="Open menu" className="flex h-full items-center border-r border-line px-3.5 text-ink-muted transition-colors hover:bg-brand hover:text-brand-ink lg:hidden">
        <Menu className="size-4" strokeWidth={1.75} />
      </DialogTrigger>
      <SheetContent title="Menu" className="w-[min(88vw,320px)]">
        <nav aria-label="Main" className="space-y-5 px-3 py-4" onClick={(event) => (event.target as Element).closest("a") && setOpen(false)}>
          {NAV.map((entry) => {
            const items = isGroup(entry) ? entry.items : [entry];
            return (
              <div key={entry.label}>
                {isGroup(entry) && <p className="mb-1 px-2.5 font-[family-name:var(--font-eyebrow)] text-[10.5px] uppercase tracking-[0.14em] text-ink-subtle">{entry.label}</p>}
                <ul className="space-y-px">
                  {items.map((item) => {
                    const Icon = ICONS[item.icon];
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={active(pathname, item.href) ? "page" : undefined}
                          className={cn("flex h-9 items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 text-[14px]", active(pathname, item.href) ? "bg-hover font-medium text-ink" : "text-ink-muted hover:bg-hover hover:text-ink")}
                        >
                          <Icon className="size-4" strokeWidth={1.75} />
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
      </SheetContent>
    </Dialog>
  );
}

export function StudentShell({ viewer, brand, children }: { viewer: Viewer; brand?: CollegeBrand; children: React.ReactNode }) {
  return (
    <div className="skin relative min-h-dvh" style={brand?.color ? accentStyle(brand.color) : undefined}>
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 -z-10 hidden w-full max-w-6xl -translate-x-1/2 border-x border-line lg:block" />
      <header className="sticky top-0 z-30 bg-canvas font-mono print:hidden">
        <div className="mx-auto flex h-12 max-w-6xl border-b border-line text-[13px] lg:border-x">
          <Mobile />
          <Link href="/student" className="flex h-full items-center gap-2.5 border-r border-line pl-4 pr-4 text-ink transition-colors hover:bg-brand hover:text-brand-ink lg:pl-5">
            <Brand brand={brand} className="[&>span:last-child]:text-[13px] [&>span:last-child]:font-semibold [&>span:last-child]:text-inherit" size={16} />
          </Link>
          <Desktop />
          <div className="ml-auto flex h-full">
            <Account viewer={viewer} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-8 sm:px-8 lg:pt-10">{children}</main>
    </div>
  );
}
