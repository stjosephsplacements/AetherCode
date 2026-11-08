import { Clock } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, LoadError, PageHeader } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import type { Attempt, Page } from "@/lib/api-types";
import { groupByPhase, listAssignments } from "@/lib/server/assignments";
import { gateway } from "@/lib/server/gateway";
import { requireViewer } from "@/lib/server/session";
import { cn, formatDateTime, formatDuration, formatWindow } from "@/lib/utils";
import { Countdown } from "../countdown";

export const metadata: Metadata = { title: "My exams" };

const TABS = [
  { key: "live", label: "Open now" },
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
] as const;

export default async function MyExams({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const viewer = await requireViewer();
  let assignments, attempts;
  try {
    [assignments, attempts] = viewer.tenantId
      ? await Promise.all([
          listAssignments(viewer.tenantId),
          gateway<Page<Attempt>>(`/submission/v1/tenants/${viewer.tenantId}/attempts?limit=100`).then((page) => page.items, () => [] as Attempt[]),
        ])
      : [[], [] as Attempt[]];
  } catch (error) {
    return (
      <>
        <PageHeader title="My exams" />
        <LoadError error={error} />
      </>
    );
  }
  const phases = groupByPhase(assignments);
  const requested = (await searchParams).tab;
  const tab = TABS.find((entry) => entry.key === requested)?.key ?? (phases.live.length ? "live" : phases.upcoming.length ? "upcoming" : phases.past.length ? "past" : "live");
  const attemptOf = new Map<string, Attempt>();
  for (const attempt of [...attempts].sort((a, b) => a.attempt_number - b.attempt_number)) attemptOf.set(attempt.candidate_assignment_id, attempt);
  const rows = phases[tab];

  return (
    <div className="animate-enter">
      <PageHeader title="My exams" description="Everything assigned to you, with its window and time limit." />
      <nav aria-label="Exam groups" className="mb-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-[var(--radius-control)] border border-line bg-sidebar p-1">
        {TABS.map((entry) => (
          <Link
            key={entry.key}
            href={`/student/exams?tab=${entry.key}`}
            scroll={false}
            aria-current={entry.key === tab ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-[calc(var(--radius-control)-2px)] px-3.5 py-1.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-4 focus-visible:ring-brand/15",
              entry.key === tab ? "bg-surface text-ink shadow-[var(--shadow-hairline)]" : "text-ink-muted hover:text-ink",
            )}
          >
            {entry.label}
            <span className="font-mono text-[11px] tabular-nums text-ink-subtle">{phases[entry.key].length}</span>
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState>{tab === "live" ? "Nothing is open right now." : tab === "upcoming" ? "No upcoming exams." : "No past exams yet."}</EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((assignment) => {
            const attempt = attemptOf.get(assignment.id);
            const unfinished = attempt && (attempt.lifecycle_state === "created" || attempt.lifecycle_state === "active");
            return (
              <li key={assignment.id} className={cn("flex flex-col rounded-3xl border bg-surface shadow-[var(--shadow-panel)] p-5", tab === "live" ? "border-brand/40" : "border-line")}>
                <div className="flex items-center justify-between gap-2">
                  {tab === "live" ? <Badge tone="brand">Open now</Badge> : tab === "upcoming" ? <Badge tone="neutral">Upcoming</Badge> : <Badge tone="neutral">{assignment.lifecycle_state === "expired" ? "Missed" : "Ended"}</Badge>}
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ink-subtle">
                    <Clock className="size-3.5" />
                    {formatDuration(assignment.duration_seconds)}
                  </span>
                </div>
                <h2 className="mt-3 line-clamp-2 text-[16px] font-semibold tracking-[-0.01em] text-ink">{assignment.title}</h2>
                <p className="mt-1 text-[12.5px] text-ink-muted">{tab === "past" ? `Finished ${formatDateTime(assignment.available_until)}` : formatWindow(assignment.available_from, assignment.available_until)}</p>
                <div className="mt-auto flex items-end justify-between gap-3 pt-5">
                  {tab !== "past" ? (
                    <div>
                      <p className="text-[11px] text-ink-subtle">{tab === "live" ? "Closes in" : "Opens in"}</p>
                      <Countdown to={tab === "live" ? assignment.available_until : assignment.available_from} className="font-mono text-[18px] font-semibold tabular-nums text-ink" />
                    </div>
                  ) : (
                    <span />
                  )}
                  {tab === "live" ? (
                    <Button asChild>
                      <Link href={`/student/exams/${assignment.id}`}>{attempt?.lifecycle_state === "active" ? "Resume exam" : "Start exam"}</Link>
                    </Button>
                  ) : tab === "upcoming" ? (
                    <Button asChild variant="secondary" size="sm">
                      <Link href={`/student/exams/${assignment.id}`}>Details</Link>
                    </Button>
                  ) : attempt ? (
                    <Button asChild variant="secondary" size="sm">
                      <Link href={unfinished ? `/student/attempts/${attempt.id}` : `/student/results/${attempt.id}`}>{unfinished ? "Resume attempt" : "View result"}</Link>
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
