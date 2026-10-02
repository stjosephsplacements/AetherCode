import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { examPhase, PHASE_TONE } from "@/lib/exam-status";
import { attemptStatus, examResults } from "@/lib/results";
import { AppShell } from "@/components/app-shell";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, Card, PageHeader, buttonClass } from "@/components/ui";

const STATUS_TONE = { absent: "neutral", in_progress: "brand", finished: "pass" } as const;
const STATUS_LABEL = { absent: "Not started", in_progress: "In progress", finished: "Finished" } as const;

export default async function ResultsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ batch?: string }> }) {
  const user = await requireUser("faculty", "admin");
  const { id } = await params;
  const { batch = "" } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [exam] = await sql<{ title: string; published: boolean; starts_at: Date; ends_at: Date; batches: string[] }[]>`
    SELECT title, published, starts_at, ends_at, batches FROM exams WHERE id = ${id}`;
  if (!exam) notFound();
  const phase = examPhase(exam);
  const { questions, rows: allRows } = await examResults(id);
  const rows = batch ? allRows.filter((row) => row.batch === batch) : allRows;
  const statuses = rows.map((row) => attemptStatus(row));
  const count = (status: string) => statuses.filter((value) => value === status).length;
  const maxTotal = questions.reduce((sum, question) => sum + question.points, 0);
  const finishedTotals = rows.filter((row) => row.attemptId).map((row) => row.total);
  const average = finishedTotals.length ? finishedTotals.reduce((a, b) => a + b, 0) / finishedTotals.length : 0;
  const pending = rows.reduce((sum, row) => sum + row.pending, 0);

  return (
    <AppShell user={user}>
      {phase === "live" && <AutoRefresh seconds={10} />}
      <PageHeader
        eyebrow={phase === "live" ? "Live monitor · refreshes every 10s" : "Results"}
        title={exam.title}
        actions={
          <>
            <Link href={`/faculty/exams/${id}`} className={buttonClass("ghost")}>
              Edit exam
            </Link>
            <Link href={`/faculty/exams/${id}/similarity`} className={buttonClass("secondary")}>
              Similarity report
            </Link>
            <a href={`/faculty/exams/${id}/results.csv${batch ? `?batch=${encodeURIComponent(batch)}` : ""}`} className={buttonClass()}>
              Export CSV
            </a>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        {[
          ["Status", <Badge key="p" tone={PHASE_TONE[phase]}>{phase}</Badge>],
          ["Not started", count("absent")],
          ["In progress", count("in_progress")],
          ["Finished", count("finished")],
          ["Average", `${average.toFixed(1)} / ${maxTotal}`],
        ].map(([label, value]) => (
          <Card key={String(label)} className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-faint">{label}</p>
            <div className="mt-1 font-display text-2xl font-semibold tracking-tight">{value}</div>
          </Card>
        ))}
      </div>
      {pending > 0 && (
        <p className="mb-4 rounded-xl bg-brand-soft px-4 py-3 text-sm text-brand-ink">
          {pending} submission{pending === 1 ? " is" : "s are"} still being graded. Scores below will update.
        </p>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        {["", ...exam.batches].map((value) => (
          <Link key={value || "all"} href={`/faculty/exams/${id}/results${value ? `?batch=${encodeURIComponent(value)}` : ""}`} className={buttonClass(value === batch ? "primary" : "secondary", "sm")}>
            {value || "All batches"}
          </Link>
        ))}
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-sunken text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5">Roll no</th>
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Batch</th>
              <th className="px-4 py-2.5">Status</th>
              {questions.map((question, index) => (
                <th key={question.id} className="px-3 py-2.5 text-right" title={question.title}>
                  Q{index + 1} <span className="font-normal normal-case text-faint">/{question.points}</span>
                </th>
              ))}
              <th className="px-4 py-2.5 text-right">Total</th>
              <th className="px-4 py-2.5 text-right" title="Window switches, fullscreen exits and blocked pastes">Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.userId} className="border-t border-line hover:bg-sunken/50">
                <td className="px-4 py-2.5 font-medium">
                  {row.attemptId ? (
                    <Link href={`/faculty/attempts/${row.attemptId}`} className="text-brand hover:underline">
                      {row.username}
                    </Link>
                  ) : (
                    row.username
                  )}
                </td>
                <td className="px-4 py-2.5">{row.name}</td>
                <td className="px-4 py-2.5 text-muted">{row.batch}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={STATUS_TONE[statuses[index]]}>{STATUS_LABEL[statuses[index]]}</Badge>
                </td>
                {questions.map((question) => (
                  <td key={question.id} className="px-3 py-2.5 text-right tabular-nums">
                    {row.scores[question.id] ?? <span className="text-faint">—</span>}
                  </td>
                ))}
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{row.attemptId ? row.total : "—"}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${row.focusLosses > 5 ? "font-semibold text-error" : "text-muted"}`}>{row.focusLosses}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-12 text-center text-sm text-muted">No students in the assigned batches.</p>}
      </Card>
    </AppShell>
  );
}
