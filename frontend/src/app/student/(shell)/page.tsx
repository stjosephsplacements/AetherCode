import { ArrowRight, Clock3, NotebookPen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge, Panel } from "@/components/ui/card";
import type { Attempt, CandidateAssignment, Page, PracticeProgress, ProfileLink } from "@/lib/api-types";
import { groupByPhase, listAssignments } from "@/lib/server/assignments";
import { communityList } from "@/lib/server/community";
import { gateway } from "@/lib/server/gateway";
import { requireViewer } from "@/lib/server/session";
import { cn, dateTile, formatDateTime, formatDuration, formatWindow } from "@/lib/utils";
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
    <div className="animate-enter">
      <h1 className="display text-[2.25rem] text-ink sm:text-[2.6rem]">{firstName ? `Welcome back, ${firstName}` : "Welcome back"}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">
        {live.length > 0
          ? live.length === 1
            ? "You have an exam open right now."
            : `You have ${live.length} exams open right now.`
          : upcoming[0]
            ? `Your next exam opens ${formatDateTime(upcoming[0].available_from)}.`
            : "Nothing is scheduled for you yet."}
      </p>

      {/* Quick Status / Progress Cards */}
      <OverviewMetrics progress={progress} examCount={assignments.length} linkedCount={links.filter((l) => l.handle).length} />

      {live.length > 0 && (
        <section aria-label="Open now" className="mt-10 space-y-3">
          {live.map((assignment) => (
            <LiveExam key={assignment.id} assignment={assignment} />
          ))}
        </section>
      )}

      {upcoming.length > 0 && (
        <ExamList title="Upcoming" assignments={upcoming} />
      )}
      {past.length > 0 && <ExamList title="Past exams" assignments={past} attemptOf={attemptOf} muted />}

      {assignments.length === 0 && (
        <div className="mt-12 rounded-[var(--radius-surface)] border border-dashed border-line-strong px-6 py-16 text-center">
          <NotebookPen className="mx-auto size-6 text-ink-subtle" strokeWidth={1.5} />
          <p className="mt-4 text-[15px] font-medium text-ink">No exams yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
            When your faculty assigns an exam to your batch, it shows up here with its date and time.
          </p>
        </div>
      )}
    </div>
  );
}

function LiveExam({ assignment }: { assignment: CandidateAssignment }) {
  const started = assignment.lifecycle_state === "started";
  return (
    <Panel className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
      <div className="min-w-0 flex-1">
        <Badge tone="success">{started ? "In progress" : "Open now"}</Badge>
        <h2 className="mt-3 text-lg font-semibold tracking-[-0.01em] text-ink">{assignment.title}</h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
          <span>Closes {formatDateTime(assignment.available_until)}</span>
          <span className="flex items-center gap-1.5">
            <Clock3 className="size-3.5" strokeWidth={1.75} />
            {formatDuration(assignment.duration_seconds)}
          </span>
        </p>
      </div>
      <Button asChild size="lg" className="sm:self-center">
        <Link href={`/student/exams/${assignment.id}`}>
          {started ? "Resume" : "Open exam"}
          <ArrowRight />
        </Link>
      </Button>
    </Panel>
  );
}

function ExamList({
  title,
  assignments,
  attemptOf,
  muted = false,
}: {
  title: string;
  assignments: CandidateAssignment[];
  attemptOf?: Map<string, Attempt>;
  muted?: boolean;
}) {
  return (
    <section className="mt-12">
      <h2 className="mb-3 text-sm font-medium text-ink-muted">{title}</h2>
      <ul className="overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
        {assignments.map((assignment, index) => {
          const [dayOfMonth, month] = dateTile(assignment.available_from);
          const status = !muted
            ? null
            : { completed: "Submitted", revoked: "Withdrawn", started: "Closed", assigned: "Missed", expired: "Missed" }[assignment.lifecycle_state];
          const row = (
            <div className={cn("flex items-center gap-4 px-4 py-3.5 sm:px-5", index > 0 && "border-t border-line")}>
              <div
                className={cn(
                  "grid w-11 shrink-0 place-items-center rounded-[var(--radius-control)] py-1.5 leading-none",
                  muted ? "bg-hover text-ink-muted" : "bg-brand-soft text-brand-soft-ink",
                )}
              >
                <span className="text-[15px] font-semibold">{dayOfMonth}</span>
                <span className="mt-1 text-[11px]">{month}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-[15px] font-medium", muted ? "text-ink-muted" : "text-ink")}>{assignment.title}</p>
                <p className="mt-0.5 truncate text-[13px] text-ink-muted">
                  {formatWindow(assignment.available_from, assignment.available_until)}
                  <span className="hidden sm:inline">, {formatDuration(assignment.duration_seconds)}</span>
                </p>
              </div>
              {status ? (
                <Badge tone={status === "Submitted" ? "success" : "neutral"}>{status}</Badge>
              ) : (
                <ArrowRight className="size-4 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5" strokeWidth={1.75} />
              )}
            </div>
          );
          const attempt = attemptOf?.get(assignment.id);
          const href = !muted
            ? `/student/exams/${assignment.id}`
            : attempt?.lifecycle_state === "active"
              ? `/student/attempts/${attempt.id}`
              : attempt?.submitted_at
                ? `/student/results/${attempt.id}`
                : null;
          return (
            <li key={assignment.id}>
              {href ? (
                <Link href={href} className="group block transition-colors hover:bg-hover">
                  {row}
                </Link>
              ) : (
                row
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
