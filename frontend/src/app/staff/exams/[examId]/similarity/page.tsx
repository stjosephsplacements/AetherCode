import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, LoadError, PageHeader, Section, Table } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import type { QuestionSimilarity } from "@/lib/api-types";
import { latestVersion } from "@/lib/server/exams";
import { gateway } from "@/lib/server/gateway";
import { requireCollege } from "@/lib/server/staff";
import { listAllStudents } from "@/lib/server/students";
import { languageName } from "@/lib/utils";

export const metadata: Metadata = { title: "Similarity" };

export default async function SimilarityPage({ params }: { params: Promise<{ examId: string }> }) {
  const staff = await requireCollege();
  const { examId } = await params;
  let data;
  try {
    const version = await latestVersion(staff.tenantId, examId);
    if (!version) throw new Error("This exam has no version.");
    const [report, students] = await Promise.all([
      gateway<QuestionSimilarity[]>(`/submission/v1/tenants/${staff.tenantId}/exam-versions/${version.id}/similarity`),
      listAllStudents(staff.tenantId),
    ]);
    data = { version, report, roll: new Map(students.map((student) => [student.principal_id, student.enrollment_number])) };
  } catch (error) {
    return (
      <>
        <PageHeader title="Similarity" />
        <LoadError error={error} />
      </>
    );
  }
  const { version, report, roll } = data;
  const student = (program: QuestionSimilarity["pairs"][number]["a"]) => (
    <Link href={`/staff/exams/${examId}/attempts/${program.attempt_id}`} className="font-mono text-[13px] text-brand hover:underline">
      {roll.get(program.candidate_id) ?? program.candidate_id.slice(0, 8)}
    </Link>
  );

  return (
    <>
      <Link href={`/staff/exams/${examId}/results`} className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        {version.title} results
      </Link>
      <PageHeader
        title="Similarity"
        description="Pairs whose latest code shares most of its unusual structure, ignoring names, comments, layout and what most of the class wrote. A high score is a reason to look, not proof."
      />
      {report.length === 0 ? (
        <EmptyState>No code saved yet.</EmptyState>
      ) : (
        report
          .toSorted((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((question) => (
            <Section
              key={question.exam_item_id}
              title={`${question.position ?? ""}${question.position ? ". " : ""}${question.title ?? "Question"}`}
              description={`${question.programs} program${question.programs === 1 ? "" : "s"} compared`}
            >
              {question.pairs.length === 0 ? (
                <EmptyState>No similar pairs.</EmptyState>
              ) : (
                <Table head={["Similarity", "Student", "Student", "Languages"]}>
                  {question.pairs.map((pair) => (
                    <tr key={`${pair.a.attempt_id}-${pair.b.attempt_id}`}>
                      <td className="px-4 py-2.5">
                        <Badge tone={pair.score >= 0.9 ? "danger" : "warning"}>{Math.round(pair.score * 100)}%</Badge>
                      </td>
                      <td className="px-4 py-2.5">{student(pair.a)}</td>
                      <td className="px-4 py-2.5">{student(pair.b)}</td>
                      <td className="px-4 py-2.5 text-ink-muted">
                        {languageName(pair.a.language)}
                        {pair.b.language !== pair.a.language && `, ${languageName(pair.b.language)}`}
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>
          ))
      )}
    </>
  );
}
