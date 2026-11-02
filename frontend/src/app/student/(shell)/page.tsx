import { ArrowRight, BookOpenCheck, CalendarClock, Code2, Flame, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import type { Attempt, Page, PracticeProgress } from "@/lib/api-types";
import { groupByPhase, listAssignments } from "@/lib/server/assignments";
import { gateway } from "@/lib/server/gateway";
import { requireViewer } from "@/lib/server/session";
import { currentStreak, weekGrid } from "@/lib/streak";
import { TIME_ZONE, cn, formatDateTime, formatDuration, formatWindow } from "@/lib/utils";
import { Countdown } from "./countdown";

export const metadata: Metadata = { title: "Dashboard" };

const DIFFICULTIES = ["easy", "medium", "hard"] as const;
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }); // YYYY-MM-DD

function Tile({ icon, label, value, note, tone }: { icon: ReactNode; label: string; value: ReactNode; note: string; tone?: "brand" }) {
  return (
    <div className="rounded-[var(--radius-surface)] border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <span className="font-[family-name:var(--font-eyebrow)] text-[10.5px] uppercase tracking-[0.14em] text-ink-subtle">{label}</span>
        <span aria-hidden className={cn("grid size-8 place-items-center rounded-[var(--radius-control)]", tone === "brand" ? "bg-brand-soft text-brand" : "bg-hover text-ink-muted")}>
          {icon}
        </span>
      </div>
      <p className="mt-3 font-mono text-[28px] font-semibold leading-none tracking-tight text-ink">{value}</p>
      <p className="mt-1.5 text-[12.5px] text-ink-muted">{note}</p>
    </div>
  );
}

export default async function StudentDashboard() {
  const viewer = await requireViewer();
  const [assignments, attempts, progress] = viewer.tenantId
    ? await Promise.all([
        listAssignments(viewer.tenantId).catch(() => []),
        gateway<Page<Attempt>>(`/submission/v1/tenants/${viewer.tenantId}/attempts?limit=100`).then((page) => page.items, () => []),
        gateway<PracticeProgress>(`/question-bank/v1/tenants/${viewer.tenantId}/practice/progress`).catch(() => null),
      ])
    : [[], [], null];
  const { live, upcoming, past } = groupByPhase(assignments);
  const attemptOf = new Map<string, Attempt>();
  for (const attempt of [...attempts].sort((a, b) => a.attempt_number - b.attempt_number)) attemptOf.set(attempt.candidate_assignment_id, attempt);

  const firstName = viewer.displayName.split(" ")[0] || viewer.username;
  const now = new Date();
  const today = DAY.format(now);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "numeric", hour12: false }).format(now)) % 24;
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateLine = new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long" }).format(now);
  const streak = progress ? currentStreak(progress.active_days, today) : 0;
  const grid = progress ? weekGrid(progress.active_days, today) : [];
  const next = live[0] ?? upcoming[0];
  const resume = live[0] && attemptOf.get(live[0].id)?.lifecycle_state === "active";
  const solvedShare = progress && progress.available > 0 ? Math.round((progress.solved / progress.available) * 100) : 0;

  return (
    <div className="animate-enter space-y-6">
      <section className="relative overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface p-6 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-brand/10 blur-3xl" />
        <div className="relative grid gap-6 lg:grid-cols-[1fr_minmax(0,380px)] lg:items-center">
          <div>
            <p className="font-[family-name:var(--font-eyebrow)] text-[10.5px] uppercase tracking-[0.14em] text-ink-subtle">{dateLine}</p>
            <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink sm:text-[34px]">
              {greeting}, {firstName}
            </h1>
            <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-ink-muted">
              {live.length > 0
                ? live.length === 1
                  ? "You have an exam open right now."
                  : `You have ${live.length} exams open right now.`
                : upcoming[0]
                  ? `Your next exam is ${upcoming[0].title}, on ${formatDateTime(upcoming[0].available_from)}.`
                  : streak > 0
                    ? `You are on a ${streak}-day practice streak. Keep it going.`
                    : "Nothing is scheduled. A good day to practice."}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {live[0] ? (
                <Button asChild size="lg">
                  <Link href={`/student/exams/${live[0].id}`}>
                    {resume ? "Resume exam" : "Start exam"}
                    <ArrowRight />
                  </Link>
                </Button>
              ) : (
                <Button asChild size="lg">
                  <Link href="/student/practice">
                    <Code2 />
                    Practice now
                  </Link>
                </Button>
              )}
              <Button asChild size="lg" variant="secondary">
                <Link href="/student/exams">All my exams</Link>
              </Button>
            </div>
          </div>

          <div className="rounded-[var(--radius-surface)] border border-line bg-canvas p-5">
            {next ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={live[0] ? "brand" : "neutral"}>{live[0] ? "Open now" : "Next exam"}</Badge>
                  <span className="text-[12px] text-ink-subtle">{formatDuration(next.duration_seconds)} limit</span>
                </div>
                <h2 className="mt-3 line-clamp-2 text-[17px] font-semibold tracking-[-0.01em] text-ink">{next.title}</h2>
                <p className="mt-1 text-[12.5px] text-ink-muted">{formatWindow(next.available_from, next.available_until)}</p>
                <div className="mt-4 flex items-end justify-between border-t border-line pt-3">
                  <span className="text-[12px] text-ink-subtle">{live[0] ? "Closes in" : "Opens in"}</span>
                  <Countdown to={live[0] ? next.available_until : next.available_from} className="font-mono text-[26px] font-semibold tabular-nums leading-none text-ink" />
                </div>
              </>
            ) : (
              <div className="py-6 text-center">
                <CalendarClock className="mx-auto size-6 text-ink-subtle" strokeWidth={1.5} />
                <p className="mt-2 text-sm font-medium text-ink">No exams scheduled</p>
                <p className="mt-0.5 text-[12.5px] text-ink-muted">New ones appear here as soon as faculty assign them.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={<CalendarClock className="size-4" />} label="Exams ahead" value={live.length + upcoming.length} note={live.length ? `${live.length} open now` : "assigned by faculty"} tone="brand" />
        <Tile icon={<BookOpenCheck className="size-4" />} label="Completed" value={past.length} note={past.length === 1 ? "exam taken" : "exams taken"} />
        <Tile icon={<Trophy className="size-4" />} label="Practice solved" value={progress ? `${progress.solved}/${progress.available}` : "-"} note={progress ? `${solvedShare}% of the set` : "progress unavailable"} />
        <Tile icon={<Flame className="size-4" />} label="Day streak" value={streak} note={streak > 0 ? "days in a row" : "practice today to start"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <section aria-label="Coming up">
            <div className="mb-2.5 flex items-end justify-between">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Coming up</h2>
              <Link href="/student/scheduled" className="text-[13px] text-brand hover:underline">
                Schedule
              </Link>
            </div>
            {live.length + upcoming.length === 0 ? (
              <p className="rounded-[var(--radius-surface)] border border-dashed border-line-strong px-5 py-8 text-center text-sm text-ink-muted">Nothing coming up.</p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
                {[...live, ...upcoming].slice(0, 5).map((assignment) => {
                  const open = live.includes(assignment);
                  return (
                    <li key={assignment.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 transition-colors hover:bg-hover">
                      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", open ? "bg-brand" : "bg-line-strong")} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium text-ink">{assignment.title}</p>
                        <p className="text-[12.5px] text-ink-muted">{formatWindow(assignment.available_from, assignment.available_until)}</p>
                      </div>
                      <span className="font-mono text-xs text-ink-subtle">{formatDuration(assignment.duration_seconds)}</span>
                      {open ? (
                        <Button asChild size="sm">
                          <Link href={`/student/exams/${assignment.id}`}>{attemptOf.get(assignment.id)?.lifecycle_state === "active" ? "Resume" : "Start"}</Link>
                        </Button>
                      ) : (
                        <Link href={`/student/exams/${assignment.id}`} className="text-[13px] text-brand hover:underline">
                          Details
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-label="Recent results">
            <div className="mb-2.5 flex items-end justify-between">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Recent exams</h2>
              <Link href="/student/completed" className="text-[13px] text-brand hover:underline">
                All completed
              </Link>
            </div>
            {past.length === 0 ? (
              <p className="rounded-[var(--radius-surface)] border border-dashed border-line-strong px-5 py-8 text-center text-sm text-ink-muted">Finished exams appear here with their results.</p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
                {past.slice(0, 4).map((assignment) => {
                  const attempt = attemptOf.get(assignment.id);
                  const unfinished = attempt && (attempt.lifecycle_state === "created" || attempt.lifecycle_state === "active");
                  return (
                    <li key={assignment.id} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-hover">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium text-ink">{assignment.title}</p>
                        <p className="text-[12.5px] text-ink-muted">Finished {formatDateTime(assignment.available_until)}</p>
                      </div>
                      {attempt ? (
                        <Link href={unfinished ? `/student/attempts/${attempt.id}` : `/student/results/${attempt.id}`} className="text-[13px] font-medium text-brand hover:underline">
                          {unfinished ? "Resume attempt" : "View result"}
                        </Link>
                      ) : (
                        <span className="text-xs text-ink-subtle">{assignment.lifecycle_state === "expired" ? "Missed" : "Ended"}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section aria-label="Practice" className="rounded-[var(--radius-surface)] border border-line bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Practice</h2>
              <Link href="/student/practice" className="text-[13px] text-brand hover:underline">
                Open
              </Link>
            </div>
            {progress ? (
              <>
                <div className="mt-4 space-y-3">
                  {DIFFICULTIES.map((level) => {
                    const row = progress.by_difficulty[level];
                    const total = row?.available ?? 0;
                    const solved = row?.solved ?? 0;
                    return (
                      <div key={level}>
                        <div className="flex items-center justify-between text-[12.5px]">
                          <span className="capitalize text-ink-muted">{level}</span>
                          <span className="font-mono tabular-nums text-ink">
                            {solved}/{total}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
                          <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${total ? Math.round((solved / total) * 100) : 0}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="mb-2 mt-5 text-[12px] text-ink-subtle">Last 14 weeks</p>
                <div className="flex gap-[3px]" role="img" aria-label={`${progress.active_days.length} active days in the last year`}>
                  {grid.map((column) => (
                    <div key={column[0]!.day} className="flex flex-1 flex-col gap-[3px]">
                      {column.map((cell) => (
                        <span key={cell.day} title={cell.day} className={cn("aspect-square rounded-[3px]", cell.future ? "bg-transparent" : cell.active ? "bg-brand" : "bg-line")} />
                      ))}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-ink-muted">Practice progress is unavailable right now.</p>
            )}
          </section>

          <section aria-label="Shortcuts" className="rounded-[var(--radius-surface)] border border-line bg-surface p-2">
            {[
              ["/student/interviews", "Interview experiences"],
              ["/student/resume", "Build your resume"],
              ["/student/tasks", "My tasks"],
              ["/student/performance", "How I am doing"],
            ].map(([href, label]) => (
              <Link key={href} href={href!} className="flex items-center justify-between rounded-[var(--radius-control)] px-3 py-2.5 text-[13.5px] text-ink-muted transition-colors hover:bg-hover hover:text-ink">
                {label}
                <ArrowRight className="size-3.5" />
              </Link>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
