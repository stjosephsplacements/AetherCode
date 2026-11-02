import { ArrowRight, BookOpenCheck, CalendarClock, Code2, FileText, Flame, MessagesSquare, Trophy, ListChecks } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Ring } from "@/components/student/ring";
import type { Attempt, Page, PracticeProgress } from "@/lib/api-types";
import { groupByPhase, listAssignments } from "@/lib/server/assignments";
import { gateway } from "@/lib/server/gateway";
import { requireViewer } from "@/lib/server/session";
import { currentStreak, weekGrid } from "@/lib/streak";
import { TIME_ZONE, cn, formatDateTime, formatDuration, formatWindow } from "@/lib/utils";
import { Countdown } from "./countdown";

export const metadata: Metadata = { title: "Dashboard" };

const LEVELS = [
  { key: "easy", label: "Easy", bar: "stroke-success", dot: "bg-success" },
  { key: "medium", label: "Medium", bar: "stroke-warning", dot: "bg-warning" },
  { key: "hard", label: "Hard", bar: "stroke-danger", dot: "bg-danger" },
] as const;
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }); // YYYY-MM-DD
const card = "rounded-3xl border border-line bg-surface shadow-[var(--shadow-panel)]";

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
  const week = progress ? weekGrid(progress.active_days, today, 1)[0]! : weekGrid([], today, 1)[0]!;
  const grid = progress ? weekGrid(progress.active_days, today, 14) : [];
  const examDays = new Set([...live, ...upcoming].map((assignment) => DAY.format(new Date(assignment.available_from))));
  const next = live[0] ?? upcoming[0];
  const resume = live[0] && attemptOf.get(live[0].id)?.lifecycle_state === "active";
  const solvedShare = progress && progress.available > 0 ? Math.round((progress.solved / progress.available) * 100) : 0;
  const ahead = [...live, ...upcoming];

  return (
    <div className="animate-enter space-y-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand via-brand to-[#ff8a3d] p-6 text-brand-ink shadow-[var(--shadow-panel)] sm:p-9">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full bg-white/15 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 left-1/3 size-72 rounded-full bg-black/10 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:22px_22px]" />
        <div className="relative grid gap-8 lg:grid-cols-[1fr_minmax(0,420px)] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-[12.5px] font-medium backdrop-blur">{dateLine}</span>
            <h1 className="mt-4 text-[2rem] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[2.8rem]">
              {greeting}, {firstName}
            </h1>
            <p className="mt-3 max-w-[52ch] text-[15.5px] leading-relaxed text-white/85">
              {live.length > 0
                ? live.length === 1
                  ? "You have an exam open right now. Good luck."
                  : `You have ${live.length} exams open right now. Good luck.`
                : upcoming[0]
                  ? `Your next exam is ${upcoming[0].title}, on ${formatDateTime(upcoming[0].available_from)}.`
                  : streak > 0
                    ? `You are on a ${streak}-day practice streak. Keep it going.`
                    : "Nothing is scheduled. A good day to practice."}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {live[0] ? (
                <Link href={`/student/exams/${live[0].id}`} className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-ink shadow-lg transition-transform hover:-translate-y-0.5">
                  {resume ? "Resume exam" : "Start exam"}
                  <ArrowRight className="size-4" />
                </Link>
              ) : (
                <Link href="/student/practice" className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-ink shadow-lg transition-transform hover:-translate-y-0.5">
                  <Code2 className="size-4" />
                  Practice now
                </Link>
              )}
              <Link href="/student/exams" className="inline-flex h-11 items-center rounded-full bg-white/15 px-6 text-[15px] font-medium text-white backdrop-blur transition-colors hover:bg-white/25">
                All my exams
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-white/25 bg-white/15 p-5 backdrop-blur-md">
            {next ? (
              <>
                <div className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="rounded-full bg-white px-2.5 py-0.5 font-semibold text-ink">{live[0] ? "Open now" : "Next exam"}</span>
                  <span className="text-white/80">{formatDuration(next.duration_seconds)} limit</span>
                </div>
                <h2 className="mt-3 line-clamp-2 text-[19px] font-semibold leading-snug">{next.title}</h2>
                <p className="mt-1 text-[13px] text-white/80">{formatWindow(next.available_from, next.available_until)}</p>
                <div className="mt-5 flex items-end justify-between border-t border-white/25 pt-4">
                  <span className="text-[12.5px] text-white/80">{live[0] ? "Closes in" : "Opens in"}</span>
                  <Countdown to={live[0] ? next.available_until : next.available_from} className="font-mono text-[34px] font-semibold tabular-nums leading-none" />
                </div>
              </>
            ) : progress ? (
              <div className="flex items-center gap-5">
                <Ring value={progress.solved} max={progress.available} size={108} stroke={10} trackClass="stroke-white/25" barClass="stroke-white">
                  <span className="font-mono text-[22px] font-semibold">{solvedShare}%</span>
                </Ring>
                <div>
                  <p className="text-[13px] text-white/80">Practice set</p>
                  <p className="mt-0.5 text-[22px] font-semibold">
                    {progress.solved}/{progress.available} solved
                  </p>
                  <p className="mt-1 text-[13px] text-white/80">No exams scheduled yet.</p>
                </div>
              </div>
            ) : (
              <div className="py-6 text-center">
                <CalendarClock className="mx-auto size-7" strokeWidth={1.5} />
                <p className="mt-2 font-semibold">No exams scheduled</p>
                <p className="mt-0.5 text-[13px] text-white/80">New ones appear here as soon as faculty assign them.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className={cn(card, "p-5")}>
          <span className="grid size-11 place-items-center rounded-2xl bg-brand-soft text-brand">
            <CalendarClock className="size-5" />
          </span>
          <p className="mt-4 text-[13px] text-ink-muted">Exams ahead</p>
          <p className="mt-0.5 font-mono text-[32px] font-semibold leading-none tracking-tight text-ink">{ahead.length}</p>
          <p className="mt-1.5 text-[12.5px] text-ink-subtle">{live.length ? `${live.length} open now` : "assigned by faculty"}</p>
        </div>
        <div className={cn(card, "p-5")}>
          <span className="grid size-11 place-items-center rounded-2xl bg-success-soft text-success">
            <BookOpenCheck className="size-5" />
          </span>
          <p className="mt-4 text-[13px] text-ink-muted">Completed</p>
          <p className="mt-0.5 font-mono text-[32px] font-semibold leading-none tracking-tight text-ink">{past.length}</p>
          <p className="mt-1.5 text-[12.5px] text-ink-subtle">{past.length === 1 ? "exam taken" : "exams taken"}</p>
        </div>
        <div className={cn(card, "flex items-center justify-between gap-3 p-5")}>
          <div>
            <span className="grid size-11 place-items-center rounded-2xl bg-warning-soft text-warning">
              <Trophy className="size-5" />
            </span>
            <p className="mt-4 text-[13px] text-ink-muted">Practice solved</p>
            <p className="mt-0.5 font-mono text-[32px] font-semibold leading-none tracking-tight text-ink">{progress ? progress.solved : "-"}</p>
            <p className="mt-1.5 text-[12.5px] text-ink-subtle">{progress ? `of ${progress.available}` : "unavailable"}</p>
          </div>
          {progress && (
            <Ring value={progress.solved} max={progress.available} size={72} stroke={8} barClass="stroke-warning">
              <span className="font-mono text-[13px] font-semibold text-ink">{solvedShare}%</span>
            </Ring>
          )}
        </div>
        <div className={cn(card, "p-5")}>
          <div className="flex items-start justify-between">
            <span className="grid size-11 place-items-center rounded-2xl bg-danger-soft text-danger">
              <Flame className="size-5" />
            </span>
            <div className="flex gap-1.5" aria-label="This week">
              {week.map((cell, index) => (
                <span key={cell.day} title={cell.day} className="flex flex-col items-center gap-1">
                  <span className={cn("size-5 rounded-full", cell.active ? "bg-danger" : cell.day === today ? "border-2 border-danger/60" : "bg-hover")} />
                  <span className="text-[10px] text-ink-subtle">{WEEKDAYS[index]}</span>
                </span>
              ))}
            </div>
          </div>
          <p className="mt-4 text-[13px] text-ink-muted">Day streak</p>
          <p className="mt-0.5 font-mono text-[32px] font-semibold leading-none tracking-tight text-ink">{streak}</p>
          <p className="mt-1.5 text-[12.5px] text-ink-subtle">{streak > 0 ? "days in a row" : "practice today to start"}</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
          {/* This week */}
          <section aria-label="This week" className={cn(card, "p-5")}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">This week</h2>
              <Link href="/student/scheduled" className="text-[13px] font-medium text-brand hover:underline">
                Full schedule
              </Link>
            </div>
            <div className="grid grid-cols-7 gap-2">
              {week.map((cell, index) => (
                <div key={cell.day} className={cn("flex flex-col items-center gap-1.5 rounded-2xl py-3", cell.day === today ? "bg-brand text-brand-ink" : "bg-hover/70")}>
                  <span className={cn("text-[11px] font-medium", cell.day === today ? "text-white/80" : "text-ink-subtle")}>{WEEKDAYS[index]}</span>
                  <span className="font-mono text-[15px] font-semibold">{Number(cell.day.slice(8))}</span>
                  <span className="flex h-2 items-center gap-1">
                    {examDays.has(cell.day) && <span className={cn("size-1.5 rounded-full", cell.day === today ? "bg-white" : "bg-brand")} />}
                    {cell.active && <span className={cn("size-1.5 rounded-full", cell.day === today ? "bg-white/70" : "bg-success")} />}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 flex flex-wrap items-center gap-4 text-[12px] text-ink-subtle">
              <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-brand" /> exam</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-success" /> practised</span>
            </p>
          </section>

          {/* Coming up */}
          <section aria-label="Coming up">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">Coming up</h2>
              <Link href="/student/exams" className="text-[13px] font-medium text-brand hover:underline">
                All exams
              </Link>
            </div>
            {ahead.length === 0 ? (
              <div className={cn(card, "px-6 py-10 text-center")}>
                <CalendarClock className="mx-auto size-7 text-ink-subtle" strokeWidth={1.5} />
                <p className="mt-2 text-[15px] font-medium text-ink">Nothing coming up</p>
                <p className="mt-0.5 text-[13px] text-ink-muted">Exams your faculty assign show up here.</p>
              </div>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {ahead.slice(0, 4).map((assignment) => {
                  const open = live.includes(assignment);
                  const date = new Date(assignment.available_from);
                  return (
                    <li key={assignment.id} className={cn(card, "flex flex-col p-5 transition-shadow hover:shadow-[var(--shadow-overlay)]", open && "border-brand/40")}>
                      <div className="flex items-start gap-4">
                        <div className={cn("grid size-14 shrink-0 place-items-center rounded-2xl text-center leading-tight", open ? "bg-brand text-brand-ink" : "bg-hover text-ink")}>
                          <span>
                            <span className="block text-[18px] font-semibold">{new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, day: "numeric" }).format(date)}</span>
                            <span className="block text-[10px] uppercase tracking-wider opacity-70">{new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, month: "short" }).format(date)}</span>
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="line-clamp-2 text-[15px] font-semibold leading-snug text-ink">{assignment.title}</p>
                          <p className="mt-1 text-[12.5px] text-ink-muted">{formatWindow(assignment.available_from, assignment.available_until)}</p>
                        </div>
                      </div>
                      <div className="mt-5 flex items-end justify-between">
                        <div>
                          <p className="text-[11.5px] text-ink-subtle">{open ? "Closes in" : "Opens in"}</p>
                          <Countdown to={open ? assignment.available_until : assignment.available_from} className="font-mono text-[19px] font-semibold tabular-nums text-ink" />
                        </div>
                        <Link
                          href={`/student/exams/${assignment.id}`}
                          className={cn("inline-flex h-9 items-center rounded-full px-4 text-[13px] font-semibold transition-colors", open ? "bg-brand text-brand-ink hover:bg-brand-hover" : "bg-hover text-ink hover:bg-line")}
                        >
                          {open ? (attemptOf.get(assignment.id)?.lifecycle_state === "active" ? "Resume" : "Start") : "Details"}
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Recent */}
          <section aria-label="Recent exams">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">Recent exams</h2>
              <Link href="/student/completed" className="text-[13px] font-medium text-brand hover:underline">
                All completed
              </Link>
            </div>
            {past.length === 0 ? (
              <div className={cn(card, "px-6 py-9 text-center text-[13.5px] text-ink-muted")}>Finished exams appear here with their results.</div>
            ) : (
              <ul className={cn(card, "divide-y divide-line overflow-hidden")}>
                {past.slice(0, 4).map((assignment) => {
                  const attempt = attemptOf.get(assignment.id);
                  const unfinished = attempt && (attempt.lifecycle_state === "created" || attempt.lifecycle_state === "active");
                  return (
                    <li key={assignment.id} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-hover/60">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-success-soft text-success">
                        <BookOpenCheck className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14.5px] font-medium text-ink">{assignment.title}</p>
                        <p className="text-[12.5px] text-ink-muted">Finished {formatDateTime(assignment.available_until)}</p>
                      </div>
                      {attempt ? (
                        <Link href={unfinished ? `/student/attempts/${attempt.id}` : `/student/results/${attempt.id}`} className="rounded-full bg-hover px-3.5 py-1.5 text-[12.5px] font-semibold text-ink transition-colors hover:bg-line">
                          {unfinished ? "Resume" : "View result"}
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
          <section aria-label="Practice" className={cn(card, "p-5")}>
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">Practice</h2>
              <Link href="/student/practice" className="text-[13px] font-medium text-brand hover:underline">
                Open
              </Link>
            </div>
            {progress ? (
              <>
                <div className="mt-5 grid grid-cols-3 gap-3">
                  {LEVELS.map((level) => {
                    const row = progress.by_difficulty[level.key];
                    return (
                      <div key={level.key} className="flex flex-col items-center gap-2 rounded-2xl bg-hover/60 py-4">
                        <Ring value={row?.solved ?? 0} max={row?.available ?? 0} size={64} stroke={7} barClass={level.bar}>
                          <span className="font-mono text-[13px] font-semibold text-ink">{row?.solved ?? 0}</span>
                        </Ring>
                        <span className="text-[12px] font-medium text-ink-muted">{level.label}</span>
                        <span className="font-mono text-[11px] text-ink-subtle">of {row?.available ?? 0}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="mb-2 mt-6 text-[12.5px] text-ink-muted">Activity, last 14 weeks</p>
                <div className="flex gap-[3px]" role="img" aria-label={`${progress.active_days.length} active days in the last year`}>
                  {grid.map((column) => (
                    <div key={column[0]!.day} className="flex flex-1 flex-col gap-[3px]">
                      {column.map((cell) => (
                        <span key={cell.day} title={cell.day} className={cn("aspect-square rounded-[4px]", cell.future ? "bg-transparent" : cell.active ? "bg-brand" : "bg-hover")} />
                      ))}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-ink-muted">Practice progress is unavailable right now.</p>
            )}
          </section>

          <section aria-label="Shortcuts" className="grid grid-cols-2 gap-3">
            {[
              { href: "/student/practice", label: "Practice", note: "Solve problems", icon: Code2, tone: "bg-brand-soft text-brand" },
              { href: "/student/interviews", label: "Interviews", note: "Real experiences", icon: MessagesSquare, tone: "bg-success-soft text-success" },
              { href: "/student/resume", label: "Resume", note: "Build and print", icon: FileText, tone: "bg-warning-soft text-warning" },
              { href: "/student/tasks", label: "My tasks", note: "Your to-do list", icon: ListChecks, tone: "bg-danger-soft text-danger" },
            ].map(({ href, label, note, icon: Icon, tone }) => (
              <Link key={href} href={href} className={cn(card, "group p-4 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-overlay)]")}>
                <span className={cn("grid size-10 place-items-center rounded-xl", tone)}>
                  <Icon className="size-[18px]" />
                </span>
                <p className="mt-3 text-[14px] font-semibold text-ink">{label}</p>
                <p className="text-[12px] text-ink-muted">{note}</p>
              </Link>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
