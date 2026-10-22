import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import { daysOfWindow, monthGrid, monthOf, parseMonth, shiftMonth } from "@/lib/calendar";
import { type ExamWithVersion, listExams } from "@/lib/server/exams";
import { requireCollege } from "@/lib/server/staff";
import { cn, formatTime, TIME_ZONE } from "@/lib/utils";

export const metadata: Metadata = { title: "Exam calendar" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Every exam window of a month, so clashes in the labs show before students are assigned. */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const staff = await requireCollege();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());
  const month = parseMonth((await searchParams).month) ?? monthOf(new Date());
  let exams: ExamWithVersion[];
  try {
    exams = await listExams(staff.tenantId);
  } catch (error) {
    return (
      <>
        <PageHeader title="Exam calendar" />
        <LoadError error={error} />
      </>
    );
  }

  const byDay = new Map<string, { examId: string; title: string; opensAt: string; published: boolean }[]>();
  for (const { exam, version } of exams) {
    if (!version || version.status === "retired") continue;
    for (const key of daysOfWindow(version.opens_at, version.closes_at)) {
      const entries = byDay.get(key) ?? [];
      entries.push({ examId: exam.id, title: version.title, opensAt: version.opens_at, published: version.status === "published" });
      byDay.set(key, entries);
    }
  }
  const label = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

  return (
    <>
      <PageHeader
        title="Exam calendar"
        description="Exam windows by day, in college time. Draft exams are shown dimmed."
        actions={
          <>
            <Button asChild variant="secondary" size="icon" aria-label="Previous month">
              <Link href={`/staff/calendar?month=${shiftMonth(month, -1)}`}>
                <ChevronLeft />
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/staff/calendar">Today</Link>
            </Button>
            <Button asChild variant="secondary" size="icon" aria-label="Next month">
              <Link href={`/staff/calendar?month=${shiftMonth(month, 1)}`}>
                <ChevronRight />
              </Link>
            </Button>
          </>
        }
      />
      <h2 className="mb-3 text-[15px] font-semibold text-ink">{label}</h2>
      <div className="overflow-x-auto">
        <div className="min-w-[720px] overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
          <div className="grid grid-cols-7 border-b border-line text-xs text-ink-muted">
            {WEEKDAYS.map((weekday) => (
              <div key={weekday} className="px-3 py-2 font-medium">
                {weekday}
              </div>
            ))}
          </div>
          {monthGrid(month).map((week) => (
            <div key={week[0]!.key} className="grid grid-cols-7 border-t border-line first:border-t-0">
              {week.map((day) => (
                <div key={day.key} className={cn("min-h-28 border-l border-line p-2 first:border-l-0", !day.inMonth && "bg-hover/50")}>
                  <p className={cn("mb-1.5 text-xs", day.inMonth ? "text-ink-muted" : "text-ink-muted/50", day.key === today && "font-semibold text-brand")}>{Number(day.key.slice(8))}</p>
                  <ul className="space-y-1">
                    {(byDay.get(day.key) ?? []).map((entry) => (
                      <li key={entry.examId}>
                        <Link
                          href={`/staff/exams/${entry.examId}`}
                          className={cn("block truncate rounded-[var(--radius-control)] bg-brand-soft px-2 py-1 text-xs text-brand-soft-ink hover:underline", !entry.published && "opacity-60")}
                          title={entry.title}
                        >
                          {formatTime(entry.opensAt)} {entry.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
