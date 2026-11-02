"use client";

import { ChevronDown, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import { AccountMenu } from "@/components/account-menu";
import { Brand } from "@/components/brand";
import { ICONS } from "@/components/nav-links";
import { ThemeToggle } from "@/components/staff/staff-nav";
import { Dialog, DialogTrigger, SheetContent } from "@/components/ui/dialog";
import { accentStyle } from "@/lib/branding";
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

const linkClass = (on: boolean) =>
  cn(
    "relative inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] outline-none transition-colors focus-visible:ring-4 focus-visible:ring-brand/15",
    on ? "bg-hover font-medium text-ink" : "text-ink-muted hover:bg-hover hover:text-ink",
  );

function Desktop() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="hidden items-center gap-0.5 lg:flex">
      {NAV.map((entry) =>
        isGroup(entry) ? (
          <DropdownMenu.Root key={entry.label}>
            <DropdownMenu.Trigger className={cn(linkClass(entry.items.some((item) => active(pathname, item.href))), "data-[state=open]:bg-hover data-[state=open]:text-ink")}>
              {entry.label}
              <ChevronDown className="size-3.5" strokeWidth={1.75} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="start" sideOffset={8} className="z-50 min-w-[200px] animate-fade rounded-[var(--radius-surface)] border border-line bg-surface p-1.5 shadow-[var(--shadow-overlay)]">
                {entry.items.map((item) => {
                  const Icon = ICONS[item.icon];
                  return (
                    <DropdownMenu.Item key={item.href} asChild>
                      <Link
                        href={item.href}
                        aria-current={active(pathname, item.href) ? "page" : undefined}
                        className={cn("flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-hover", active(pathname, item.href) ? "font-medium text-ink" : "text-ink-muted data-[highlighted]:text-ink")}
                      >
                        <Icon className="size-4" strokeWidth={1.75} />
                        {item.label}
                      </Link>
                    </DropdownMenu.Item>
                  );
                })}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : (
          <Link key={entry.href} href={entry.href} aria-current={active(pathname, entry.href) ? "page" : undefined} className={linkClass(active(pathname, entry.href))}>
            {entry.label}
          </Link>
        ),
      )}
    </nav>
  );
}

function Mobile() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger aria-label="Open menu" className="-ml-1.5 grid size-9 place-items-center rounded-[var(--radius-control)] text-ink-muted transition-colors hover:bg-hover hover:text-ink lg:hidden">
        <Menu className="size-[18px]" strokeWidth={1.75} />
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
    <div className="min-h-dvh" style={brand?.color ? accentStyle(brand.color) : undefined}>
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur print:hidden">
        <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-3 px-4 sm:px-6">
          <Mobile />
          <Link href="/student" className="mr-2 shrink-0">
            <Brand brand={brand} />
          </Link>
          <Desktop />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <AccountMenu viewer={viewer} compact />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1240px] px-4 pb-24 pt-8 sm:px-6 lg:pt-10">{children}</main>
    </div>
  );
}
