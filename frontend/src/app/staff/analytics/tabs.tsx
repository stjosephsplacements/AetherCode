import Link from "next/link";
import { cn } from "@/lib/utils";

/** Exam results, and for platform administrators the live Platform view beside it. */
export function AnalyticsTabs({ active, platform }: { active: "exams" | "platform"; platform: boolean }) {
  if (!platform) return null;
  const tabs = [
    { key: "exams", label: "Exams", href: "/staff/analytics" },
    { key: "platform", label: "Platform", href: "/staff/analytics/platform" },
  ] as const;
  return (
    <nav aria-label="Analytics views" className="mb-5 inline-flex rounded-[var(--radius-control)] border border-line p-0.5 text-[13.5px]">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={cn("rounded-[calc(var(--radius-control)-2px)] px-4 py-1.5 transition-colors", active === tab.key ? "bg-hover font-medium text-ink" : "text-ink-muted hover:text-ink")}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
