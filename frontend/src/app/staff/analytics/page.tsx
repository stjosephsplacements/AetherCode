import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, LoadError, PageHeader, Section, Table } from "@/components/staff/page-header";
import type { ExamResult, Page, Student } from "@/lib/api-types";
import { listBatches, listDepartments } from "@/lib/server/directory";
import { type ExamWithVersion, listExams, mapLimit } from "@/lib/server/exams";
import { gateway } from "@/lib/server/gateway";
import { requireCollege } from "@/lib/server/staff";
import { listAllStudents } from "@/lib/server/students";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Analytics" };

/** A graded attempt at or above this share of the marks passes. */
const PASS_SHARE = 0.4;

type Scored = { exam: ExamWithVersion; candidate: string; share: number };

const percent = (share: number) => `${Math.round(share * 100)}%`;
const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

/** Exam results across the college, by exam, department, batch and student. */
export default async function AnalyticsPage() {
  const staff = await requireCollege();
  let data;
  try {
    const [exams, students, departments, batches] = await Promise.all([
      listExams(staff.tenantId),
      listAllStudents(staff.tenantId),
      listDepartments(staff.tenantId),
      listBatches(staff.tenantId),
    ]);
    const published = exams.filter((entry) => entry.version && entry.version.status !== "draft");
    const results = await mapLimit(published, 6, async (entry) => ({
        exam: entry,
      results: await gateway<ExamResult[]>(`/analytics/v1/tenants/${staff.tenantId}/exam-results?exam_version_id=${entry.version!.id}&limit=5000`).catch(() => []),
    }));
    // Batch membership comes from each batch's student list.
    const batchOf = new Map<string, string>();
    await mapLimit(batches, 6, async (batch) => {
      const page = await gateway<Page<Student>>(`/user/v1/tenants/${staff.tenantId}/students?batch_id=${batch.id}&limit=100`).catch(() => null);
      for (const student of page?.items ?? []) batchOf.set(student.principal_id, batch.id);
    });
    data = { results, students, departments, batches, batchOf };
  } catch (error) {
    return (
      <>
        <PageHeader title="Analytics" />
        <LoadError error={error} />
      </>
    );
  }
  const { results, students, departments, batches, batchOf } = data;
  const studentBy = new Map(students.map((student) => [student.principal_id, student]));

  const scored: Scored[] = results.flatMap(({ exam, results: rows }) =>
    rows
      .filter((row) => Number(row.maximum_score) > 0)
      .map((row) => ({ exam, candidate: row.candidate_id, share: Number(row.score) / Number(row.maximum_score) })),
  );
  const examsHeld = results.filter((entry) => entry.results.length > 0);

  const group = (key: (row: Scored) => string | undefined) => {
    const groups = new Map<string, Scored[]>();
    for (const row of scored) {
      const id = key(row);
      if (id) groups.set(id, [...(groups.get(id) ?? []), row]);
    }
    return groups;
  };
  const summary = (rows: Scored[]) => ({
    attempts: rows.length,
    students: new Set(rows.map((row) => row.candidate)).size,
    average: mean(rows.map((row) => row.share)),
    pass: rows.filter((row) => row.share >= PASS_SHARE).length / Math.max(rows.length, 1),
  });
  const byDepartment = group((row) => studentBy.get(row.candidate)?.college_department_id);
  const byBatch = group((row) => batchOf.get(row.candidate));
  const byStudent = [...group((row) => row.candidate)].map(([candidate, rows]) => ({
    candidate,
    roll: studentBy.get(candidate)?.enrollment_number ?? candidate.slice(0, 8),
    exams: rows.length,
    average: mean(rows.map((row) => row.share)),
  }));
  const ranked = [...byStudent].sort((a, b) => b.average - a.average || b.exams - a.exams);
  const overall = summary(scored);

  return (
    <>
      <PageHeader title="Analytics" description={`Graded exam results across the college. Pass means at least ${percent(PASS_SHARE)} of the marks.`} />
      {scored.length === 0 ? (
        <EmptyState>No graded exams yet. Results appear here once students finish an exam.</EmptyState>
      ) : (
        <>
          <section aria-label="Summary" className="grid gap-3 sm:grid-cols-4">
            <Stat label="Exams held" value={String(examsHeld.length)} />
            <Stat label="Graded attempts" value={String(overall.attempts)} />
            <Stat label="Average score" value={percent(overall.average)} />
            <Stat label="Pass rate" value={percent(overall.pass)} />
          </section>

          <Section title="Exams">
            <Table head={["Exam", "Opened", "Graded", "Average", "Highest", "Lowest", "Pass rate"]}>
              {examsHeld
                .sort((a, b) => b.exam.version!.opens_at.localeCompare(a.exam.version!.opens_at))
                .map(({ exam, results: rows }) => {
                  const shares = rows.filter((row) => Number(row.maximum_score) > 0).map((row) => Number(row.score) / Number(row.maximum_score));
                  return (
                    <tr key={exam.exam.id} className="border-t border-line">
                      <td className="px-4 py-2.5">
                        <Link href={`/staff/exams/${exam.exam.id}/results`} className="font-medium text-ink hover:text-brand">
                          {exam.version!.title}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-ink-muted">{formatDateTime(exam.version!.opens_at)}</td>
                      <td className="px-4 py-2.5 tabular-nums">{rows.length}</td>
                      <td className="px-4 py-2.5 tabular-nums">{percent(mean(shares))}</td>
                      <td className="px-4 py-2.5 tabular-nums">{shares.length ? percent(Math.max(...shares)) : "-"}</td>
                      <td className="px-4 py-2.5 tabular-nums">{shares.length ? percent(Math.min(...shares)) : "-"}</td>
                      <td className="px-4 py-2.5 tabular-nums">{percent(shares.filter((share) => share >= PASS_SHARE).length / Math.max(shares.length, 1))}</td>
                    </tr>
                  );
                })}
            </Table>
          </Section>

          <div className="grid gap-x-6 lg:grid-cols-2">
            <Breakdown title="By department" rows={departments.map((department) => ({ id: department.id, name: department.name, ...summary(byDepartment.get(department.id) ?? []) }))} />
            <Breakdown title="By batch" rows={batches.map((batch) => ({ id: batch.id, name: `${batch.name} (${batch.academic_year})`, ...summary(byBatch.get(batch.id) ?? []) }))} />
          </div>

          <div className="grid gap-x-6 lg:grid-cols-2">
            <StudentList title="Top performers" rows={ranked.slice(0, 10)} />
            <StudentList title="Needs attention" description={`Average below ${percent(PASS_SHARE)}, lowest first.`} rows={ranked.filter((row) => row.average < PASS_SHARE).reverse().slice(0, 10)} />
          </div>
        </>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-surface)] border border-line bg-surface px-5 py-4">
      <p className="text-[13px] text-ink-muted">{label}</p>
      <p className="mt-1 font-mono text-[1.75rem] font-medium leading-tight tabular-nums text-ink">{value}</p>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { id: string; name: string; attempts: number; students: number; average: number; pass: number }[] }) {
  const shown = rows.filter((row) => row.attempts > 0).sort((a, b) => b.average - a.average);
  return (
    <Section title={title}>
      {shown.length === 0 ? (
        <EmptyState>No graded attempts yet.</EmptyState>
      ) : (
        <Table head={["Name", "Students", "Attempts", "Average", "Pass rate"]}>
          {shown.map((row) => (
            <tr key={row.id} className="border-t border-line">
              <td className="px-4 py-2.5 font-medium text-ink">
                {row.name}
                <span className="mt-1 block h-1 w-full max-w-40 overflow-hidden rounded-full bg-hover">
                  <span className={cn("block h-full rounded-full", row.average >= PASS_SHARE ? "bg-success" : "bg-danger")} style={{ width: percent(row.average) }} />
                </span>
              </td>
              <td className="px-4 py-2.5 tabular-nums">{row.students}</td>
              <td className="px-4 py-2.5 tabular-nums">{row.attempts}</td>
              <td className="px-4 py-2.5 tabular-nums">{percent(row.average)}</td>
              <td className="px-4 py-2.5 tabular-nums">{percent(row.pass)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

function StudentList({ title, description, rows }: { title: string; description?: string; rows: { candidate: string; roll: string; exams: number; average: number }[] }) {
  return (
    <Section title={title} description={description}>
      {rows.length === 0 ? (
        <EmptyState>Nobody here.</EmptyState>
      ) : (
        <Table head={["Roll number", "Exams", "Average"]}>
          {rows.map((row) => (
            <tr key={row.candidate} className="border-t border-line">
              <td className="px-4 py-2.5 font-mono text-[13px] text-ink">{row.roll}</td>
              <td className="px-4 py-2.5 tabular-nums">{row.exams}</td>
              <td className="px-4 py-2.5 tabular-nums">{percent(row.average)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}
