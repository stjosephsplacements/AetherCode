"use client";

import { Activity, BookOpen, CalendarDays, GitFork, ListChecks, MessagesSquare, Newspaper, Rocket, Trophy, UserRound, ChartColumn, ScrollText, Building2, CodeXml, House, LifeBuoy, NotebookPen, TrendingUp, UserCog, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ICONS = { exams: NotebookPen, home: House, questions: BookOpen, students: Users, organisation: Building2, accounts: UserCog, status: Activity, help: LifeBuoy, practice: CodeXml, progress: TrendingUp, analytics: ChartColumn, audit: ScrollText, calendar: CalendarDays, contests: Trophy, hackathons: Rocket, opensource: GitFork, interviews: MessagesSquare, blogs: Newspaper, tasks: ListChecks, profile: UserRound, community: MessagesSquare };

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS };

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        // "/staff" and "/student" are every page's parent, so they are active only on their own page.
        const active = pathname === item.href || (item.href !== "/staff" && item.href !== "/student" && pathname.startsWith(`${item.href}/`));
        const Icon = ICONS[item.icon];
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 text-sm transition-colors",
                active ? "bg-hover font-medium text-ink" : "text-ink-muted hover:bg-hover hover:text-ink",
              )}
            >
              <Icon className="size-[18px]" strokeWidth={1.75} />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
