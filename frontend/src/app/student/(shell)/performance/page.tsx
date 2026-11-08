import { Fire, Medal, Percent, Trophy } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { EmptyState, PageHeader } from "@/components/staff/page-header";
import type { Attempt, AttemptResult, CandidateAssignment, Page, PracticeProgress } from "@/lib/api-types";
import { LiveRefresh } from "@/lib/client/realtime";
import { listAssignments } from "@/lib/server/assignments";
import { gateway } from "@/lib/server/gateway";
import { requireViewer } from "@/lib/server/session";
import { currentStreak, weekGrid } from "@/lib/streak";
import { TIME_ZONE, cn, formatDateTime } from "@/lib/utils";
import { SolvedBars } from "../progress/solved-bars";

export const metadata: Metadata = { title: "Performance" };

const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });

function Tile({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note?: string }) {
  return (
    <div className="rounded-3xl border border-line bg-surface shadow-[var(--shadow-panel)] p-5">
      <div className="flex items-center justify-between">
        <span className="font-[family-name:var(--font-eyebrow)] text-[10.5px] uppercase tracking-[0.14em] text-ink-subtle">{label}</span>
        <span aria-hidden className="grid size-8 place-items-center rounded-[var(--radius-control)] bg-hover text-ink-muted">
          {icon}
        </span>
      </div>
      <p className="mt-3 font-mono text-[28px] font-semibold leading-none tracking-tight text-ink">{value}</p>
      {note && <p className="mt-1.5 text-[12.5px] text-ink-muted">{note}</p>}
    </div>
  );
}

export default async function PerformancePage() {
  const viewer = await requireViewer();
  if (!viewer.tenantId) redirect("/student");
  const tenantPath = `/submission/v1/tenants/${viewer.tenantId}`;
  const [practice, attempts, assignments] = await Promise.all([
    gateway<PracticeProgress>(`/question-bank/v1/tenants/${viewer.tenantId}/practice/progress`).catch(() => null),
    gateway<Page<Attempt>>(`${tenantPath}/attempts?limit=100`).then((page) => page.items, () => [] as Attempt[]),
    listAssignments(viewer.tenantId).catch(() => [] as CandidateAssignment[]),
  ]);
  const titles = new Map(assignments.map((assignment) => [assignment.id, assignment.title]));
  const finished = attempts
    .filter((attempt) => ["submitted", "grading", "graded", "expired"].includes(attempt.lifecycle_state))
    .sort((a, b) => (b.submitted_at ?? b.submission_deadline).localeCompare(a.submitted_at ?? a.submission_deadline))
    .slice(0, 20);
  const results = await Promise.all(
    finished.map(async (attempt) => ({ attempt, result: await gateway<AttemptResult>(`${tenantPath}/attempts/${attempt.id}/result`).catch(() => null) })),
  );
  const released = results.filter((entry) => entry.result?.released && entry.result.maximum_score > 0);
  const average = released.length ? released.reduce((sum, entry) => sum + (entry.result!.released ? entry.result!.score / entry.result!.maximum_score : 0), 0) / released.length : null;
  const today = DAY.format(new Date());
  const streak = practice ? currentStreak(practice.active_days, today) : 0;
  const grid = practice ? weekGrid(practice.active_days, today, 26) : [];
  const recentDays = grid.flat().filter((cell) => cell.active).length;

  return (
    <div className="animate-enter">
      <LiveRefresh topics={["grading"]} />
      <PageHeader title="Performance" description="Your scores, practice progress and streak." />

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={<Medal className="size-4" />} label="Exams taken" value={String(finished.length)} note={finished.length === 1 ? "exam finished" : "exams finished"} />
        <Tile icon={<Percent className="size-4" />} label="Average score" value={average === null ? "-" : `${Math.round(average * 100)}%`} note={average === null ? "once results are released" : `over ${released.length} released`} />
        <Tile
          icon={<Trophy className="size-4" />}
          label="Practice accepted"
          value={practice && practice.submissions > 0 ? `${Math.round((practice.accepted / practice.submissions) * 100)}%` : "-"}
          note={practice ? `${practice.accepted} of ${practice.submissions} submissions` : undefined}
        />
        <Tile icon={<Fire className="size-4" />} label="Day streak" value={String(streak)} note={streak > 0 ? "days in a row" : "practice today to start"} />
      </section>

      {practice && (
        <section aria-label="Practice" className="mt-8">
          <h2 className="mb-2.5 text-[15px] font-semibold tracking-[-0.01em] text-ink">Practice</h2>
          {practice.available > 0 ? <SolvedBars progress={practice} /> : <EmptyState>No practice problems yet. Your faculty adds them.</EmptyState>}
          <div className="mt-3 rounded-3xl border border-line bg-surface shadow-[var(--shadow-panel)] p-5">
            <p className="text-[13px] text-ink-muted">
              Practised on <span className="font-medium text-ink">{recentDays}</span> day{recentDays === 1 ? "" : "s"} in the last six months
            </p>
            <div className="mt-3 flex gap-[3px] overflow-x-auto" role="img" aria-label={`${recentDays} active days in the last six months`}>
              {grid.map((column) => (
                <div key={column[0]!.day} className="flex flex-none flex-col gap-[3px]">
                  {column.map((cell) => (
                    <span key={cell.day} title={cell.day} className={cn("size-3 rounded-[3px]", cell.future ? "bg-transparent" : cell.active ? "bg-brand" : "bg-line-strong")} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section aria-label="Exams" className="mt-8">
        <h2 className="mb-2.5 text-[15px] font-semibold tracking-[-0.01em] text-ink">Exam results</h2>
        {results.length === 0 ? (
          <EmptyState>Exams you finish appear here with their scores.</EmptyState>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface shadow-[var(--shadow-panel)]">
            {results.map(({ attempt, result }) => {
              const share = result?.released && result.maximum_score > 0 ? Math.round((result.score / result.maximum_score) * 100) : null;
              return (
                <li key={attempt.id}>
                  <Link href={`/student/results/${attempt.id}`} className="flex flex-wrap items-center gap-4 px-5 py-3.5 transition-colors hover:bg-hover">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="truncate text-[14.5px] font-medium text-ink">{titles.get(attempt.candidate_assignment_id) ?? "Exam"}</p>
                      <p className="mt-0.5 text-[12.5px] text-ink-muted">{formatDateTime(attempt.submitted_at ?? attempt.submission_deadline)}</p>
                    </div>
                    {share !== null && (
                      <span className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-line sm:block" aria-hidden>
                        <span className="block h-full rounded-full bg-brand" style={{ width: `${share}%` }} />
                      </span>
                    )}
                    <span className="w-24 text-right font-mono text-sm tabular-nums text-ink">
                      {result?.released ? `${result.score} / ${result.maximum_score}` : <span className="text-ink-subtle">Not released</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
