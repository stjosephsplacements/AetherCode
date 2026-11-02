import { ArrowRight } from "lucide-react";

import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { Attempt, Page, PracticeProgress } from "@/lib/api-types";
import { groupByPhase, listAssignments } from "@/lib/server/assignments";
import { gateway } from "@/lib/server/gateway";
import { requireViewer } from "@/lib/server/session";
import { currentStreak, weekGrid } from "@/lib/streak";
import { TIME_ZONE, cn, formatDateTime, formatDuration, formatWindow } from "@/lib/utils";
import { AsciiWordmark } from "@/components/site/ascii-wordmark";
import { WORDMARK_COLUMNS } from "@/components/site/wordmark";
import { Countdown } from "./countdown";
import { Eyebrow, TermLink } from "./term";

export const metadata: Metadata = { title: "Dashboard" };

const DIFFICULTIES = ["easy", "medium", "hard"] as const;
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }); // YYYY-MM-DD

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

  const statLabel = "mt-1 text-[14px] text-ink-muted";
  return (
    <div className="animate-enter">
      <section className="relative isolate flex flex-col items-center overflow-hidden px-2 pb-12 pt-8 text-center sm:pt-12">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-20 hidden overflow-hidden md:block">
          <div className="aurora absolute -left-[10%] top-[8%] h-[70%] w-[55%] bg-[radial-gradient(closest-side,var(--brand-soft),transparent)]" />
          <div className="aurora absolute -right-[8%] top-[20%] h-[70%] w-[50%] bg-[radial-gradient(closest-side,var(--glow-2),transparent)] [animation-delay:-9s]" />
        </div>
        <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_62%_46%_at_50%_42%,var(--canvas)_40%,transparent)]" />
        <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-subtle">{dateLine}</p>
        <div className="mt-5" aria-hidden>
          <AsciiWordmark style={{ "--columns": WORDMARK_COLUMNS + 30 } as React.CSSProperties} />
        </div>
        <h1 className="heading mt-8 text-[1.7rem] leading-[1.3] text-ink sm:text-[2.4rem]">
          <span className="marker">
            {greeting}, {firstName}.
          </span>
        </h1>
        <p className="mt-5 max-w-[60ch] font-mono text-[13.5px] text-ink-muted">
          <span className="bg-canvas px-1">
            {"// "}
            {live.length > 0
              ? live.length === 1
                ? "you have an exam open right now."
                : `you have ${live.length} exams open right now.`
              : upcoming[0]
                ? `next up: ${upcoming[0].title.toLowerCase()}, ${formatDateTime(upcoming[0].available_from)}.`
                : streak > 0
                  ? `${streak}-day practice streak. keep it going.`
                  : "nothing scheduled. a good day to practice."}
          </span>
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {live[0] ? (
            <TermLink primary href={`/student/exams/${live[0].id}`}>
              {resume ? "resume exam ->" : "start exam ->"}
            </TermLink>
          ) : (
            <TermLink primary href="/student/practice">
              practice now -&gt;
            </TermLink>
          )}
          <TermLink href="/student/exams">my exams</TermLink>
        </div>

        {next && (
          <div className="mt-10 w-full max-w-[460px] border border-ink bg-canvas p-5 text-left shadow-[4px_4px_0_var(--ink)]">
            <div className="flex items-center justify-between font-mono text-[12px]">
              <span className="text-brand">[ {live[0] ? "open now" : "next exam"} ]</span>
              <span className="text-ink-subtle">{formatDuration(next.duration_seconds)} limit</span>
            </div>
            <h2 className="mt-3 line-clamp-2 text-[17px] font-semibold text-ink">{next.title}</h2>
            <p className="mt-1 text-[12.5px] text-ink-muted">{formatWindow(next.available_from, next.available_until)}</p>
            <div className="mt-4 flex items-end justify-between border-t border-line pt-3">
              <span className="font-mono text-[12px] text-ink-subtle">{live[0] ? "closes in" : "opens in"}</span>
              <Countdown to={live[0] ? next.available_until : next.available_from} className="font-mono text-[26px] font-semibold tabular-nums leading-none text-ink" />
            </div>
          </div>
        )}

        <nav aria-label="Shortcuts" className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 font-mono text-[13px]">
          {[
            ["/student/practice", "[_]", "practice"],
            ["/student/interviews", "[?]", "interviews"],
            ["/student/resume", "[#]", "resume"],
            ["/student/help", "[~]", "help"],
          ].map(([href, glyph, label]) => (
            <Link key={href} href={href!} className="bg-canvas px-1 text-ink-muted transition-colors hover:text-ink">
              <span className="text-brand">{glyph}</span> {label}
            </Link>
          ))}
        </nav>
      </section>

      <dl className="mb-10 grid divide-line border-y border-line bg-canvas sm:grid-cols-4 sm:divide-x">
        {[
          ["exams ahead", String(live.length + upcoming.length), live.length ? `${live.length} open now` : "assigned by faculty"],
          ["completed", String(past.length), past.length === 1 ? "exam taken" : "exams taken"],
          ["practice solved", progress ? `${progress.solved}/${progress.available}` : "-", progress ? `${solvedShare}% of the set` : "unavailable"],
          ["day streak", String(streak), streak > 0 ? "days in a row" : "practice today to start"],
        ].map(([label, value, note]) => (
          <div key={label} className="flex flex-col-reverse px-6 py-7">
            <dt className={statLabel}>
              {label} <span className="text-ink-subtle">· {note}</span>
            </dt>
            <dd className="text-[2.2rem] font-bold leading-none tracking-[-0.04em] text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <section aria-label="Coming up">
            <Eyebrow action={<Link href="/student/scheduled" className="text-[13px] text-brand hover:underline">
                Schedule
              </Link>}>coming up</Eyebrow>
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
            <Eyebrow action={<Link href="/student/completed" className="text-[13px] text-brand hover:underline">
                All completed
              </Link>}>recent exams</Eyebrow>
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
