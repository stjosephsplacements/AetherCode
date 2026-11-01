import { ArrowRight, Clock3 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge, Panel } from "@/components/ui/card";
import type { Attempt, Page, PracticeProgress, ProfileLink } from "@/lib/api-types";
import { groupByPhase, listAssignments } from "@/lib/server/assignments";
import { communityList } from "@/lib/server/community";
import { gateway } from "@/lib/server/gateway";
import { requireViewer } from "@/lib/server/session";
import { formatDateTime, formatDuration, formatWindow } from "@/lib/utils";
import { OverviewMetrics } from "./overview-metrics";

export const metadata: Metadata = { title: "My exams" };

export default async function StudentDashboard() {
  const viewer = await requireViewer();
  const [assignments, attempts, progress, links] = viewer.tenantId
    ? await Promise.all([
        listAssignments(viewer.tenantId),
        // Results links are a convenience: the dashboard still loads without them.
        gateway<Page<Attempt>>(`/submission/v1/tenants/${viewer.tenantId}/attempts?limit=100`).then((page) => page.items, () => []),
        gateway<PracticeProgress>(`/question-bank/v1/tenants/${viewer.tenantId}/practice/progress`).catch(() => null),
        communityList<ProfileLink>(viewer.tenantId, "profile-links").catch(() => []),
      ])
    : [[], [], null, []];
  const { live, upcoming, past } = groupByPhase(assignments);
  // The newest attempt of each assignment; staff extra time can keep one open past the window.
  const attemptOf = new Map<string, Attempt>();
  for (const attempt of [...attempts].sort((a, b) => a.attempt_number - b.attempt_number)) attemptOf.set(attempt.candidate_assignment_id, attempt);
  const firstName = viewer.displayName.split(" ")[0];

  return (
    <div className="animate-enter space-y-10">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="eyebrow text-brand">DEVELOPER WORKSPACE</span>
        </div>
        <h1 className="display text-[2.25rem] text-ink sm:text-[2.6rem]">{firstName ? `Welcome back, ${firstName}` : "Welcome back"}</h1>
        <p className="mt-2 text-[15px] text-ink-muted">
          {live.length > 0
            ? live.length === 1
              ? "You have an exam open right now."
              : `You have ${live.length} exams open right now.`
            : upcoming[0]
              ? `Your next exam opens ${formatDateTime(upcoming[0].available_from)}.`
              : "Ready to practice or take assigned assessments."}
        </p>
      </div>

      <OverviewMetrics progress={progress} examCount={assignments.length} linkedCount={links.length} />

      {/* Live now */}
      {live.length > 0 && (
        <section aria-label="Open now" className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-brand"></span>
            </span>
            <h2 className="eyebrow text-brand">LIVE ASSESSMENTS</h2>
          </div>
          <div className="space-y-3">
            {live.map((assignment) => {
              const attempt = attemptOf.get(assignment.id);
              const opensNow = attempt?.lifecycle_state === "active";
              return (
                <Panel key={assignment.id} className="relative overflow-hidden border-brand/30 bg-surface/90 p-5 shadow-sm transition-all hover:border-brand">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge tone="brand">Open now</Badge>
                        <span className="text-xs text-ink-muted">{formatWindow(assignment.available_from, assignment.available_until)}</span>
                      </div>
                      <h3 className="mt-2 text-lg font-semibold text-ink">{assignment.title}</h3>
                      <p className="mt-1 text-sm text-ink-muted flex items-center gap-1.5">
                        <Clock3 className="size-3.5" /> {formatDuration(assignment.duration_seconds)} limit
                      </p>
                    </div>
                    <Button asChild size="lg" className="shrink-0 font-medium">
                      <Link href={`/student/exams/${assignment.id}`}>
                        {opensNow ? "Resume exam" : "Start exam"} <ArrowRight className="size-4 ml-1" />
                      </Link>
                    </Button>
                  </div>
                </Panel>
              );
            })}
          </div>
        </section>
      )}

      {/* Upcoming exams */}
      {upcoming.length > 0 && (
        <section aria-label="Upcoming" className="space-y-4">
          <h2 className="eyebrow text-ink-muted">SCHEDULED ASSESSMENTS</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {upcoming.map((assignment) => (
              <Panel key={assignment.id} className="p-5 border-line bg-surface/70">
                <span className="text-xs text-ink-subtle">{formatDateTime(assignment.available_from)}</span>
                <h3 className="mt-1 text-base font-medium text-ink">{assignment.title}</h3>
                <p className="mt-2 text-xs text-ink-muted">Duration: {formatDuration(assignment.duration_seconds)}</p>
              </Panel>
            ))}
          </div>
        </section>
      )}

      {/* Past attempts */}
      {past.length > 0 && (
        <section aria-label="Past" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="eyebrow text-ink-muted">COMPLETED EXAMS</h2>
            <Link href="/student/progress" className="text-xs text-brand hover:underline font-medium">
              View all results →
            </Link>
          </div>
          <Panel className="divide-y divide-line overflow-hidden">
            {past.slice(0, 5).map((assignment) => {
              const attempt = attemptOf.get(assignment.id);
              return (
                <div key={assignment.id} className="flex items-center justify-between p-4 transition-colors hover:bg-hover/50">
                  <div>
                    <p className="font-medium text-sm text-ink">{assignment.title}</p>
                    <p className="text-xs text-ink-muted">Finished {formatDateTime(assignment.available_until)}</p>
                  </div>
                  {attempt && (attempt.lifecycle_state === "created" || attempt.lifecycle_state === "active") ? (
                    <Link href={`/student/attempts/${attempt.id}`} className="text-xs font-medium text-brand hover:underline">
                      Resume attempt →
                    </Link>
                  ) : attempt ? (
                    <Link href={`/student/results/${attempt.id}`} className="text-xs font-medium text-brand hover:underline">
                      Review attempt →
                    </Link>
                  ) : (
                    // Attempts load best-effort, so a missing one is not proof the exam was missed.
                    <span className="text-xs text-ink-subtle">{assignment.lifecycle_state === "expired" ? "Missed" : "Ended"}</span>
                  )}
                </div>
              );
            })}
          </Panel>
        </section>
      )}
    </div>
  );
}
