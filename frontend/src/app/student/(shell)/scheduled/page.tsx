import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Panel, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requireViewer } from "@/lib/server/session";
import { listAssignments, groupByPhase } from "@/lib/server/assignments";
import { formatDateTime, formatDuration, formatWindow } from "@/lib/utils";
import { Calendar, Clock3 } from "lucide-react";

export const metadata: Metadata = { title: "Scheduled Assessments" };

export default async function ScheduledAssessmentsPage() {
  const viewer = await requireViewer();
  if (!viewer.tenantId) redirect("/student");

  const assignments = await listAssignments(viewer.tenantId).catch(() => []);
  const { upcoming, live } = groupByPhase(assignments);

  return (
    <div className="animate-enter space-y-8">
      <div>
        <span className="eyebrow text-brand">EXAM TIMETABLE</span>
        <h1 className="display mt-1 text-[2.25rem] text-ink sm:text-[2.6rem]">Scheduled Assessments</h1>
        <p className="mt-2 text-[15px] text-ink-muted">
          Upcoming coding rounds, campus drive tests, and practice windows assigned to your cohort.
        </p>
      </div>

      {live.length > 0 && (
        <section className="space-y-3">
          <h2 className="eyebrow text-brand">OPEN NOW</h2>
          <div className="space-y-3">
            {live.map((a) => (
              <Panel key={a.id} className="p-5 border-brand/40 bg-surface/90 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <Badge tone="brand">Active Window</Badge>
                    <h3 className="mt-2 text-base font-semibold text-ink">{a.title}</h3>
                    <p className="mt-1 text-xs text-ink-muted">{formatWindow(a.available_from, a.available_until)}</p>
                  </div>
                  <Button asChild size="sm">
                    <Link href={`/student/exams/${a.id}`}>Enter Exam →</Link>
                  </Button>
                </div>
              </Panel>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="eyebrow text-ink-muted">UPCOMING EXAMS</h2>
        {upcoming.length === 0 ? (
          <Panel className="p-8 text-center border-line bg-surface/70">
            <p className="text-sm text-ink-muted">No upcoming exams currently scheduled.</p>
          </Panel>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {upcoming.map((a) => (
              <Panel key={a.id} className="p-5 border-line bg-surface/80">
                <div className="flex items-center gap-2 text-xs text-brand font-medium">
                  <Calendar className="size-3.5" />
                  Opens {formatDateTime(a.available_from)}
                </div>
                <h3 className="mt-2 text-base font-semibold text-ink">{a.title}</h3>
                <p className="mt-2 text-xs text-ink-muted flex items-center gap-1.5">
                  <Clock3 className="size-3.5" /> Duration: {formatDuration(a.duration_seconds)}
                </p>
              </Panel>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
