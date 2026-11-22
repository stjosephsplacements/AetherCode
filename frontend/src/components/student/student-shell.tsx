"use client";

import { CaretDown, List } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import { AccountMenu } from "@/components/account-menu";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/staff/staff-nav";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { accentStyle } from "@/lib/branding";
import type { Brand as CollegeBrand } from "@/lib/server/branding";
import { cn } from "@/lib/utils";
import type { Viewer } from "@/lib/viewer";

type Item = { href: string; label: string };
type Entry = Item | { label: string; items: Item[] };

/** Text-first student chrome: a few places up front, the rest under menus. */
const NAV: Entry[] = [
  { href: "/student", label: "Dashboard" },
  {
    label: "Exams",
    items: [
      { href: "/student/exams", label: "My exams" },
      { href: "/student/scheduled", label: "Scheduled" },
      { href: "/student/completed", label: "Completed" },
    ],
  },
  { href: "/student/practice", label: "Practice" },
  { href: "/student/performance", label: "Performance" },
  {
    label: "Career",
    items: [
      { href: "/student/interviews", label: "Interviews" },
      { href: "/student/contests", label: "Contests" },
      { href: "/student/hackathons", label: "Hackathons" },
      { href: "/student/open-source", label: "Open source" },
      { href: "/student/blogs", label: "Blogs" },
    ],
  },
  {
    label: "Me",
    items: [
      { href: "/student/tasks", label: "My tasks" },
      { href: "/student/profile", label: "My profile" },
      { href: "/student/resume", label: "My resume" },
      { href: "/student/get-started", label: "Get started" },
      { href: "/student/help", label: "Help" },
    ],
  },
];

const isGroup = (entry: Entry): entry is { label: string; items: Item[] } => "items" in entry;
const active = (pathname: string, href: string) => (href === "/student" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

const linkClass = (on: boolean) =>
  cn(
    "relative inline-flex h-9 items-center gap-1.5 rounded-control px-3 text-[13.5px] font-medium outline-none transition-colors focus-visible:ring-4 focus-visible:ring-brand/20",
    on ? "bg-hover text-ink" : "text-ink-muted hover:bg-hover hover:text-ink",
  );

function Desktop() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="hidden items-center gap-0.5 lg:flex">
      {NAV.map((entry) => {
        const on = isGroup(entry) ? entry.items.some((item) => active(pathname, item.href)) : active(pathname, entry.href);
        return isGroup(entry) ? (
          <DropdownMenu.Root key={entry.label}>
            <DropdownMenu.Trigger className={cn(linkClass(on), "data-[state=open]:bg-hover data-[state=open]:text-ink")}>
              {entry.label}
              <CaretDown className="size-3.5 opacity-70" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="start" sideOffset={8} className="z-50 min-w-[200px] animate-fade rounded-surface border border-line bg-surface p-1 shadow-[var(--shadow-overlay)]">
                {entry.items.map((item) => {
                  const here = active(pathname, item.href);
                  return (
                    <DropdownMenu.Item key={item.href} asChild>
                      <Link
                        href={item.href}
                        aria-current={here ? "page" : undefined}
                        className={cn(
                          "flex items-center rounded-control px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-hover",
                          here ? "font-medium text-ink" : "text-ink-muted data-[highlighted]:text-ink",
                        )}
                      >
                        {item.label}
                      </Link>
                    </DropdownMenu.Item>
                  );
                })}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : (
          <Link key={entry.href} href={entry.href} aria-current={on ? "page" : undefined} className={linkClass(on)}>
            {entry.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Mobile() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger aria-label="Open menu" className="-ml-1.5 grid size-9 place-items-center rounded-control text-ink-muted transition-colors hover:bg-hover hover:text-ink lg:hidden">
        <List className="size-[18px]" />
      </DialogTrigger>
      <DialogContent title="Menu" className="!fixed !inset-auto !left-3 !top-16 !w-[min(calc(100vw-24px),340px)] !max-h-[calc(100dvh-80px)] !translate-x-0 !translate-y-0 !rounded-surface">
        <nav aria-label="Main" className="space-y-5 overflow-y-auto px-4 pb-5" onClick={(event) => (event.target as Element).closest("a") && setOpen(false)}>
          {NAV.map((entry) => {
            const items = isGroup(entry) ? entry.items : [entry];
            return (
              <div key={entry.label}>
                {isGroup(entry) && <p className="mb-2 px-1 font-[family-name:var(--font-eyebrow)] text-[10px] uppercase tracking-[0.16em] text-ink-subtle">{entry.label}</p>}
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const current = active(pathname, item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={current ? "page" : undefined}
                          className={cn(
                            "flex items-center rounded-control px-3 py-2.5 text-[15px] transition-colors",
                            current ? "bg-hover font-medium text-ink" : "text-ink-muted active:bg-hover",
                          )}
                        >
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
      </DialogContent>
    </Dialog>
  );
}

export function StudentShell({ viewer, brand, children }: { viewer: Viewer; brand?: CollegeBrand; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh" style={brand?.color ? accentStyle(brand.color) : undefined}>
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 px-3 backdrop-blur-md sm:px-6 print:hidden">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-2">
          <Mobile />
          <Link href="/student" className="mr-3 shrink-0">
            <Brand brand={brand} />
          </Link>
          <Desktop />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <AccountMenu viewer={viewer} compact />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1400px] px-3 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
