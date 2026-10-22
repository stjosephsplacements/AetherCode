import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Attempt, AttemptResult, CandidateAssignment, Page, PracticeProgress } from "@/lib/api-types";
import { listAssignments } from "@/lib/server/assignments";
import { gateway } from "@/lib/server/gateway";
import { requireViewer } from "@/lib/server/session";
import { cn, formatDateTime } from "@/lib/utils";
import { SolvedBars } from "./solved-bars";

export const metadata: Metadata = { title: "My progress" };

const WEEKS = 26;

export default async function ProgressPage() {
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
    finished.map(async (attempt) => ({
      attempt,
      result: await gateway<AttemptResult>(`${tenantPath}/attempts/${attempt.id}/result`).catch(() => null),
    })),
  );
  const released = results.filter((entry) => entry.result?.released && entry.result.maximum_score > 0);
  const average = released.length
    ? released.reduce((sum, entry) => sum + (entry.result!.released ? entry.result!.score / entry.result!.maximum_score : 0), 0) / released.length
    : null;

  return (
    <div className="animate-enter">
      <h1 className="display text-[2.25rem] text-ink sm:text-[2.6rem]">My progress</h1>
      <p className="mt-2 text-[15px] text-ink-muted">Your exam results and practice, in one place.</p>

      <section aria-label="Summary" className="mt-8 grid gap-3 sm:grid-cols-3">
        <Stat label="Exams taken" value={String(finished.length)} />
        <Stat label="Average score" value={average === null ? "–" : `${Math.round(average * 100)}%`} hint={average === null ? "once results are released" : `over ${released.length} released`} />
        <Stat
          label="Practice acceptance"
          value={practice && practice.submissions > 0 ? `${Math.round((practice.accepted / practice.submissions) * 100)}%` : "–"}
          hint={practice ? `${practice.accepted} of ${practice.submissions} submissions` : undefined}
        />
      </section>

      {practice && (
        <section aria-label="Practice" className="mt-10">
          <h2 className="text-sm font-semibold text-ink">Practice</h2>
          {practice.available > 0 ? <SolvedBars progress={practice} className="mt-3" /> : <p className="mt-2 text-sm text-ink-muted">No practice problems yet.</p>}
          <Activity days={practice.active_days} />
        </section>
      )}

      <section aria-label="Exams" className="mt-10">
        <h2 className="text-sm font-semibold text-ink">Exams</h2>
        {results.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Exams you finish appear here.</p>
        ) : (
          <ul className="mt-3 overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
            {results.map(({ attempt, result }, index) => (
              <li key={attempt.id} className={cn(index > 0 && "border-t border-line")}>
                <Link href={`/student/results/${attempt.id}`} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-hover">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium text-ink">{titles.get(attempt.candidate_assignment_id) ?? "Exam"}</p>
                    <p className="mt-0.5 text-[13px] text-ink-muted">{formatDateTime(attempt.submitted_at ?? attempt.submission_deadline)}</p>
                  </div>
                  <span className="font-mono text-sm tabular-nums text-ink">
                    {result?.released ? `${result.score} / ${result.maximum_score}` : <span className="text-ink-subtle">Not released</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-surface)] border border-line bg-surface px-5 py-4">
      <p className="text-[13px] text-ink-muted">{label}</p>
      <p className="mt-1 font-mono text-[1.75rem] font-medium leading-tight tabular-nums text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-subtle">{hint}</p>}
    </div>
  );
}

/** Days with practice in the last 26 weeks, one square per day, weeks as columns. */
function Activity({ days }: { days: string[] }) {
  const active = new Set(days);
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const start = new Date(today);
  start.setDate(start.getDate() - (WEEKS * 7 - 1) - start.getDay());
  const cells: { key: string; on: boolean; future: boolean }[] = [];
  for (let offset = 0; offset < WEEKS * 7 + today.getDay() + 1 && cells.length < (WEEKS + 1) * 7; offset++) {
    const day = new Date(start);
    day.setDate(start.getDate() + offset);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    cells.push({ key, on: active.has(key), future: day > today });
  }
  const recent = days.filter((day) => cells.some((cell) => cell.key === day)).length;
  return (
    <div className="mt-4 rounded-[var(--radius-surface)] border border-line bg-surface p-5">
      <p className="text-[13px] text-ink-muted">
        Practised on <span className="font-medium text-ink">{recent}</span> day{recent === 1 ? "" : "s"} in the last six months
      </p>
      <div className="mt-3 grid grid-flow-col grid-rows-7 gap-[3px] overflow-x-auto" aria-hidden>
        {cells.map((cell) => (
          <span key={cell.key} title={cell.key} className={cn("size-[11px] rounded-[2px]", cell.future ? "bg-transparent" : cell.on ? "bg-brand" : "bg-hover")} />
        ))}
      </div>
    </div>
  );
}
