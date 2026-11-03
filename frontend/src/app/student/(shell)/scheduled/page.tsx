import { CalendarDots } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, PageHeader } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import { groupByPhase, listAssignments } from "@/lib/server/assignments";
import { requireViewer } from "@/lib/server/session";
import { TIME_ZONE, formatDuration, formatWindow } from "@/lib/utils";
import { Countdown } from "../countdown";

export const metadata: Metadata = { title: "Scheduled" };

const day = new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, day: "numeric" });
const month = new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, month: "short" });

export default async function ScheduledPage() {
  const viewer = await requireViewer();
  if (!viewer.tenantId) redirect("/student");
  // Failures go to the error boundary; an empty list would read as "no exams".
  const { upcoming, live } = groupByPhase(await listAssignments(viewer.tenantId));
  const rows = [...live, ...upcoming];

  return (
    <div className="animate-enter">
      <PageHeader title="Scheduled" description="Exams open now and the ones coming up, soonest first." />
      {rows.length === 0 ? (
        <EmptyState>
          <CalendarDots className="mx-auto mb-3 size-6 text-ink-subtle" />
          Nothing is scheduled. New exams show up here as soon as faculty assign them.
        </EmptyState>
      ) : (
        <ol className="space-y-3">
          {rows.map((assignment) => {
            const open = live.includes(assignment);
            const date = new Date(assignment.available_from);
            return (
              <li key={assignment.id} className={`flex flex-wrap items-center gap-4 rounded-3xl border bg-surface shadow-[var(--shadow-panel)] p-4 ${open ? "border-brand/40" : "border-line"}`}>
                <div aria-hidden className={`grid size-14 shrink-0 place-items-center rounded-[var(--radius-control)] text-center leading-tight ${open ? "bg-brand text-brand-ink" : "bg-hover text-ink"}`}>
                  <span>
                    <span className="block text-[18px] font-semibold">{day.format(date)}</span>
                    <span className="block text-[10.5px] uppercase tracking-wider opacity-80">{month.format(date)}</span>
                  </span>
                </div>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="truncate text-[15px] font-semibold text-ink">{assignment.title}</p>
                  <p className="mt-0.5 text-[12.5px] text-ink-muted">{formatWindow(assignment.available_from, assignment.available_until)}</p>
                  <p className="mt-0.5 font-mono text-xs text-ink-subtle">{formatDuration(assignment.duration_seconds)} limit</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-ink-subtle">{open ? "Closes in" : "Opens in"}</p>
                  <Countdown to={open ? assignment.available_until : assignment.available_from} className="font-mono text-[17px] font-semibold tabular-nums text-ink" />
                </div>
                {open && (
                  <Button asChild>
                    <Link href={`/student/exams/${assignment.id}`}>Enter exam</Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
