import Link from "next/link";
import type { ReactNode } from "react";
import { Tile } from "@/components/staff/tile";
import { EmptyState, PageHeader, Table } from "@/components/staff/page-header";
import { type Attempt, type ExamPoint, histogram, passes, percent, spread, type Summary } from "@/lib/analytics";
import { collegeHref } from "@/lib/links";
import { PASS_SHARE } from "@/lib/results";
import { cn, formatDateTime } from "@/lib/utils";
import { ExamTrend, ScoreHistogram } from "./charts";
import { type StudentRow, StudentList } from "./student-list";

export type AnalyticsData = {
  attempts: Pick<Attempt, "share">[];
  points: ExamPoint[];
  recent: ExamPoint[];
  overall: Summary;
  change: number | null;
  departmentRows: Rank[];
  batchRows: Rank[];
  students: StudentRow[];
  needAttention: StudentRow[];
};

/** Everything the Analytics page shows, from numbers already worked out; no loading happens here. */
export function AnalyticsView({ data, several, actions, notice, scope, tabs }: { data: AnalyticsData; several: boolean; actions?: ReactNode; notice?: ReactNode; scope: string; tabs?: ReactNode }) {
  const { attempts, points, recent, overall, change, departmentRows, batchRows, students, needAttention } = data;
  const spreadOf = spread(attempts.map((attempt) => attempt.share));
  return (
    <>
      {tabs}
      <PageHeader
        title="Analytics"
        description={`Graded results across ${scope}. Pass means at least ${percent(PASS_SHARE)} of the marks.`}
        actions={actions}
      />
      {notice}
      {attempts.length === 0 ? (
        <EmptyState>No graded exams yet. Results appear here once students finish an exam.</EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-12">
          <Tile
            label="Average score"
            className="md:col-span-2 xl:col-span-6 xl:row-span-2"
            expand={{ title: "Every exam", description: "Newest first. Pass means at least " + percent(PASS_SHARE) + " of the marks.", content: <ExamTable points={recent} several={several} /> }}
          >
            <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
              <p className="text-[56px] font-semibold leading-none tracking-[-0.04em] tabular-nums text-ink">{percent(overall.average)}</p>
              {change !== null && (
                <p className={cn("pb-1.5 font-mono text-[13px] tabular-nums", change >= 0 ? "text-success" : "text-danger")}>
                  {change >= 0 ? "Up" : "Down"} {Math.abs(Math.round(change))} points on the exam before
                </p>
              )}
            </div>
            <p className="mt-2 text-[13px] text-ink-muted">
              {overall.attempts} graded attempts by {overall.students} students, {percent(overall.pass)} passed.
            </p>
            <ExamTrend points={points} />
          </Tile>

          <Figure label="Pass rate" value={percent(overall.pass)} note={`${Math.round(overall.pass * overall.attempts)} of ${overall.attempts} attempts`} tone={overall.pass >= 0.5 ? "success" : "danger"} className="xl:col-span-3" />
          <Figure label="Graded attempts" value={String(overall.attempts)} note="every graded run of an exam" className="xl:col-span-3" />
          <Figure label="Students" value={String(overall.students)} note="with at least one graded exam" className="xl:col-span-3" />
          <Figure label="Exams held" value={String(points.length)} note={recent[0] ? `latest: ${recent[0].title}` : ""} className="xl:col-span-3" />

          <Tile label="Score distribution" className="md:col-span-1 xl:col-span-5">
            <p className="text-[13px] text-ink-muted">How many attempts landed in each tenth of the marks. Red bars are under the pass mark.</p>
            <ScoreHistogram buckets={histogram(attempts.map((attempt) => attempt.share))} />
            {spreadOf && (
              <dl className="mt-auto grid grid-cols-4 gap-3 pt-5">
                {[
                  ["Median", percent(spreadOf.median)],
                  ["Highest", percent(spreadOf.highest)],
                  ["Lowest", percent(spreadOf.lowest)],
                  ["Under the mark", String(spreadOf.below)],
                ].map(([term, value]) => (
                  <div key={term}>
                    <dt className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-subtle">{term}</dt>
                    <dd className="mt-1 text-[17px] font-semibold tabular-nums tracking-[-0.01em] text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Tile>

          <Tile
            label="Exams"
            className="md:col-span-1 xl:col-span-7"
            expand={{ title: "Every exam", description: "Newest first.", content: <ExamTable points={recent} several={several} /> }}
          >
            <ExamRows points={recent.slice(0, 6)} />
          </Tile>

          <Tile label="Departments" className="md:col-span-1 xl:col-span-6" expand={{ title: "Departments", description: "Best average first.", content: <RankTable rows={departmentRows} /> }}>
            <RankBars rows={departmentRows.slice(0, 6)} empty="No graded attempts by department yet." />
          </Tile>
          <Tile label="Batches" className="md:col-span-1 xl:col-span-6" expand={{ title: "Batches", description: "Best average first.", content: <RankTable rows={batchRows} /> }}>
            <RankBars rows={batchRows.slice(0, 6)} empty="No graded attempts by batch yet." />
          </Tile>

          <Tile label="Top performers" className="md:col-span-1 xl:col-span-6" expand={{ title: "All students", description: "Ranked by average across their graded exams.", content: <StudentList rows={students} several={several} /> }}>
            <PeopleRows rows={students.slice(0, 6)} several={several} empty="Nobody has a graded exam yet." />
          </Tile>
          <Tile
            label="Needs attention"
            className="md:col-span-1 xl:col-span-6"
            expand={{ title: "Needs attention", description: `Average below ${percent(PASS_SHARE)}, lowest first.`, content: <StudentList rows={needAttention} several={several} /> }}
          >
            <PeopleRows rows={needAttention.slice(0, 6)} several={several} empty={`Everyone is at or above ${percent(PASS_SHARE)}.`} />
          </Tile>
        </div>
      )}
    </>
  );
}

type Tone = "success" | "danger";
const DOT: Record<Tone, string> = { success: "bg-success", danger: "bg-danger" };

function Figure({ label, value, note, tone, className }: { label: string; value: string; note: string; tone?: Tone; className?: string }) {
  return (
    <Tile label={label} className={className}>
      <p className="mt-auto flex items-center gap-2.5 text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-ink">
        {tone && <span aria-hidden className={cn("size-2 rounded-full", DOT[tone])} />}
        {value}
      </p>
      <p className="mt-2 truncate text-[12.5px] text-ink-muted">{note}</p>
    </Tile>
  );
}

export type Rank = { id: string; name: string; attempts: number; students: number; average: number; pass: number };

/** Horizontal bars, one per group: the average, with a tick at the pass mark. Under the mark is red and says so. */
function RankBars({ rows, empty }: { rows: Rank[]; empty: string }) {
  if (rows.length === 0) return <p className="my-auto py-6 text-center text-sm text-ink-muted">{empty}</p>;
  return (
    <ul className="space-y-3.5">
      {rows.map((row) => (
        <li key={row.id}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[13.5px] text-ink">{row.name}</span>
            <span className="font-mono text-[13px] tabular-nums text-ink">{percent(row.average)}</span>
          </div>
          <div className="relative mt-1.5 h-1.5 rounded-full bg-hover">
            <span className={cn("block h-full rounded-full", passes(row.average) ? "bg-ink/55" : "bg-danger/70")} style={{ width: percent(Math.min(row.average, 1)) }} />
            <span aria-hidden className="absolute -top-0.5 h-2.5 border-l border-dashed border-ink-muted" style={{ left: percent(PASS_SHARE) }} />
          </div>
          <p className="mt-1 font-mono text-[11px] text-ink-subtle">
            {row.students} students, {row.attempts} attempts, {percent(row.pass)} passed{passes(row.average) ? "" : ", below the pass mark"}
          </p>
        </li>
      ))}
    </ul>
  );
}

function RankTable({ rows }: { rows: Rank[] }) {
  return rows.length === 0 ? (
    <EmptyState>No graded attempts yet.</EmptyState>
  ) : (
    <Table head={["Name", "Students", "Attempts", "Average", "Pass rate"]}>
      {rows.map((row) => (
        <tr key={row.id} className="border-t border-line">
          <td className="px-4 py-2.5 font-medium text-ink">{row.name}</td>
          <td className="px-4 py-2.5 tabular-nums">{row.students}</td>
          <td className="px-4 py-2.5 tabular-nums">{row.attempts}</td>
          <td className={cn("px-4 py-2.5 tabular-nums", !passes(row.average) && "text-danger")}>{percent(row.average)}</td>
          <td className="px-4 py-2.5 tabular-nums">{percent(row.pass)}</td>
        </tr>
      ))}
    </Table>
  );
}

function PeopleRows({ rows, several, empty }: { rows: StudentRow[]; several: boolean; empty: string }) {
  if (rows.length === 0) return <p className="my-auto py-6 text-center text-sm text-ink-muted">{empty}</p>;
  return (
    <ol className="divide-y divide-line">
      {rows.map((row, index) => (
        <li key={row.candidate} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 py-2 text-[13.5px]">
          <span className="font-mono text-[11.5px] tabular-nums text-ink-subtle">{index + 1}</span>
          <span className="min-w-0 truncate">
            <span className="font-mono text-ink">{row.roll}</span>
            {several && row.college && <span className="ml-2 text-ink-muted">{row.college}</span>}
          </span>
          <span className={cn("font-mono tabular-nums", passes(row.average) ? "text-ink" : "text-danger")}>{percent(row.average)}</span>
        </li>
      ))}
    </ol>
  );
}

/** The latest exams, each with its average as a bar and a link to the full results. */
function ExamRows({ points }: { points: ExamPoint[] }) {
  return (
    <ul className="divide-y divide-line">
      {points.map((point) => (
        <li key={point.id} className="grid grid-cols-[minmax(0,1fr)_7rem_3.5rem] items-center gap-3 py-2.5">
          <div className="min-w-0">
            <Link href={collegeHref(`/staff/exams/${point.id}/results`, point.college?.id)} className="block truncate text-[13.5px] font-medium text-ink transition-colors hover:text-brand">
              {point.title}
            </Link>
            <p className="truncate font-mono text-[11px] text-ink-subtle">
              {point.college ? `${point.college.name}, ` : ""}
              {formatDateTime(point.at)}, {point.graded} graded
            </p>
          </div>
          <div className="relative h-1.5 rounded-full bg-hover" aria-hidden>
            <span className={cn("block h-full rounded-full", passes(point.average) ? "bg-ink/55" : "bg-danger/70")} style={{ width: percent(Math.min(point.average, 1)) }} />
            <span className="absolute -top-0.5 h-2.5 border-l border-dashed border-ink-muted" style={{ left: percent(PASS_SHARE) }} />
          </div>
          <span className={cn("text-right font-mono text-[13px] tabular-nums", passes(point.average) ? "text-ink" : "text-danger")}>{percent(point.average)}</span>
        </li>
      ))}
    </ul>
  );
}

function ExamTable({ points, several }: { points: ExamPoint[]; several: boolean }) {
  return (
    <Table head={several ? ["Exam", "College", "Opened", "Graded", "Average", "Highest", "Lowest", "Pass rate"] : ["Exam", "Opened", "Graded", "Average", "Highest", "Lowest", "Pass rate"]}>
      {points.map((point) => (
        <tr key={point.id} className="border-t border-line">
          <td className="px-4 py-2.5">
            <Link href={collegeHref(`/staff/exams/${point.id}/results`, point.college?.id)} className="font-medium text-ink hover:text-brand">
              {point.title}
            </Link>
          </td>
          {several && <td className="px-4 py-2.5 text-ink-muted">{point.college?.name}</td>}
          <td className="whitespace-nowrap px-4 py-2.5 text-ink-muted">{formatDateTime(point.at)}</td>
          <td className="px-4 py-2.5 tabular-nums">{point.graded}</td>
          <td className={cn("px-4 py-2.5 tabular-nums", !passes(point.average) && "text-danger")}>{percent(point.average)}</td>
          <td className="px-4 py-2.5 tabular-nums">{percent(point.highest)}</td>
          <td className="px-4 py-2.5 tabular-nums">{percent(point.lowest)}</td>
          <td className="px-4 py-2.5 tabular-nums">{percent(point.pass)}</td>
        </tr>
      ))}
    </Table>
  );
}
