import type { Metadata } from "next";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import type { ExamResult, Page, Student } from "@/lib/api-types";
import { LiveRefresh } from "@/lib/client/realtime";
import { listBatches, listDepartments } from "@/lib/server/directory";
import { listExams, mapLimit } from "@/lib/server/exams";
import { gateway } from "@/lib/server/gateway";
import { inColleges } from "@/lib/server/colleges";
import { collegesFor, requireStaff } from "@/lib/server/staff";
import { listAllStudents } from "@/lib/server/students";
import { type Attempt, type ExamPoint, latestChange, mean, passes, shareOf, summarize } from "@/lib/analytics";
import { type StudentRow } from "./student-list";
import { AnalyticsView } from "./view";

export const metadata: Metadata = { title: "Analytics" };



/** Exam results across the college, by exam, department, batch and student. */
export default async function AnalyticsPage() {
  const staff = await requireStaff();
  let data;
  try {
    const perCollege = await inColleges(collegesFor(staff), async (collegeId) => {
      const [exams, students, departments, batches] = await Promise.all([listExams(collegeId), listAllStudents(collegeId), listDepartments(collegeId), listBatches(collegeId)]);
      const published = exams.filter((entry) => entry.version && entry.version.status !== "draft");
      const results = await mapLimit(published, 6, async (entry) => ({
        exam: entry,
        results: await gateway<ExamResult[]>(`/analytics/v1/tenants/${collegeId}/exam-results?exam_version_id=${entry.version!.id}&limit=5000`).catch(() => []),
      }));
      // Batch membership comes from each batch's student list.
      const batchOf = new Map<string, string>();
      await mapLimit(batches, 6, async (batch) => {
        const page = await gateway<Page<Student>>(`/user/v1/tenants/${collegeId}/students?batch_id=${batch.id}&limit=100`).catch(() => null);
        for (const student of page?.items ?? []) batchOf.set(student.principal_id, batch.id);
      });
      return { results, students, departments, batches, batchOf };
    });
    // Every id is a UUID, so the colleges' data can be pooled and the same tables work across them.
    const several = false;
    data = {
      results: perCollege.flatMap(({ college, value }) => (value?.results ?? []).map((entry) => ({ ...entry, college }))),
      students: perCollege.flatMap(({ value }) => value?.students ?? []),
      departments: perCollege.flatMap(({ college, value }) => (value?.departments ?? []).map((department) => (several ? { ...department, name: `${department.name} (${college.name})` } : department))),
      batches: perCollege.flatMap(({ value }) => value?.batches ?? []),
      batchOf: new Map(perCollege.flatMap(({ value }) => [...(value?.batchOf ?? [])])),
      unreachable: perCollege.filter((entry) => entry.failed).map((entry) => entry.college.name),
    };
  } catch (error) {
    return (
      <>
      <PageHeader title="Analytics" />
        <LoadError error={error} />
      </>
    );
  }
  const { results, students, departments, batches, batchOf, unreachable } = data;
  const several = false;
  const studentBy = new Map(students.map((student) => [student.principal_id, student]));

  const held = results.filter((entry) => entry.results.some((row) => shareOf(row.score, row.maximum_score) !== null));
  const attempts: Attempt[] = held.flatMap(({ exam, results: rows }) =>
    rows.flatMap((row) => {
      const share = shareOf(row.score, row.maximum_score);
      return share === null ? [] : [{ exam: exam.exam.id, candidate: row.candidate_id, share }];
    }),
  );
  const points: ExamPoint[] = held.map(({ exam, college, results: rows }) => {
    const shares = rows.flatMap((row) => {
      const share = shareOf(row.score, row.maximum_score);
      return share === null ? [] : [share];
    });
    return {
      id: exam.exam.id,
      title: exam.version!.title,
      at: exam.version!.opens_at,
      graded: shares.length,
      average: mean(shares),
      pass: shares.filter(passes).length / Math.max(shares.length, 1),
      highest: Math.max(...shares),
      lowest: Math.min(...shares),
      college: several ? { id: college.id, name: college.name } : undefined,
    };
  });

  const group = (key: (attempt: Attempt) => string | undefined) => {
    const groups = new Map<string, Attempt[]>();
    for (const attempt of attempts) {
      const id = key(attempt);
      if (id) groups.set(id, [...(groups.get(id) ?? []), attempt]);
    }
    return groups;
  };
  const byDepartment = group((attempt) => studentBy.get(attempt.candidate)?.college_department_id);
  const byBatch = group((attempt) => batchOf.get(attempt.candidate));
  const rank = (items: { id: string; name: string }[], groups: Map<string, Attempt[]>) =>
    items.map((item) => ({ ...item, ...summarize(groups.get(item.id) ?? []) })).filter((row) => row.attempts > 0).sort((a, b) => b.average - a.average);
  const departmentRows = rank(departments, byDepartment);
  const batchRows = rank(batches.map((batch) => ({ id: batch.id, name: `${batch.name} (${batch.academic_year})` })), byBatch);

  const students_: StudentRow[] = [...group((attempt) => attempt.candidate)]
    .map(([candidate, rows]) => ({
      candidate,
      roll: studentBy.get(candidate)?.enrollment_number ?? candidate.slice(0, 8),
      exams: rows.length,
      average: mean(rows.map((row) => row.share)),
      college: undefined,
    }))
    .sort((a, b) => b.average - a.average || b.exams - a.exams);
  const needAttention = students_.filter((row) => !passes(row.average)).reverse();

  const overall = summarize(attempts);
  const change = latestChange(points);
  const recent = [...points].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <>
    <LiveRefresh topics={["grading"]} />
    <AnalyticsView
      several={several}
      scope="the college"
      notice={unreachable.length > 0 ? <p role="alert" className="mb-4 text-sm text-warning">Could not load: {unreachable.join(", ")}.</p> : undefined}
      data={{ attempts, points, recent, overall, change, departmentRows, batchRows, students: students_, needAttention }}
    />
    </>
  );
}
