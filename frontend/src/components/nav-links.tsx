"use client";

import { BookOpen, Briefcase, Buildings, CalendarBlank, ChartBar, Chats, CodeSimple, FileText, GitFork, House, Lifebuoy, ListChecks, Newspaper, NotePencil, Pulse, Question, Rocket, Scroll, ShieldCheck, TrendUp, Trophy, UserCircle, UserGear, Users } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const ICONS = { exams: NotePencil, home: House, questions: BookOpen, students: Users, organisation: Buildings, accounts: UserGear, roles: ShieldCheck, status: Pulse, help: Lifebuoy, practice: CodeSimple, progress: TrendUp, analytics: ChartBar, audit: Scroll, calendar: CalendarBlank, contests: Trophy, hackathons: Rocket, opensource: GitFork, interviews: Chats, blogs: Newspaper, tasks: ListChecks, profile: UserCircle, resume: FileText, community: Chats, placements: Briefcase, start: Rocket, faq: Question };

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; /** Why the page cannot be used yet; shown instead of a link. */ locked?: string };

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
              <Icon className="size-[18px]" />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
