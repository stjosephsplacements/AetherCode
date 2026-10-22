import { ArrowLeft, ScanSearch } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, LoadError, PageHeader, Table } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import { Badge, Panel } from "@/components/ui/card";
import type { ExamResult, ExamVersionContent } from "@/lib/api-types";
import { latestVersion } from "@/lib/server/exams";
import { gateway } from "@/lib/server/gateway";
import { requireCollege } from "@/lib/server/staff";
import { listAllStudents } from "@/lib/server/students";
import { formatDateTime, formatScoreText } from "@/lib/utils";
import { ExportButton } from "./export-button";

export const metadata: Metadata = { title: "Results" };

export default async function ResultsPage({ params }: { params: Promise<{ examId: string }> }) {
  const staff = await requireCollege();
  const { examId } = await params;
  let data;
  try {
    const version = await latestVersion(staff.tenantId, examId);
    if (!version) throw new Error("This exam has no version.");
    const [results, content, students] = await Promise.all([
      gateway<ExamResult[]>(`/analytics/v1/tenants/${staff.tenantId}/exam-results?exam_version_id=${version.id}&limit=5000`),
      gateway<ExamVersionContent>(`/assessment/v1/tenants/${staff.tenantId}/exam-versions/${version.id}/content`),
      listAllStudents(staff.tenantId),
    ]);
    data = { version, results, content, students };
  } catch (error) {
    return (
      <>
        <PageHeader title="Results" />
        <LoadError error={error} />
      </>
    );
  }
  const { version, results, content, students } = data;
  const rollNumber = new Map(students.map((student) => [student.principal_id, student.enrollment_number]));
  const rows = results
    .map((result) => ({ ...result, roll: rollNumber.get(result.candidate_id) ?? result.candidate_id.slice(0, 8) }))
    .sort((a, b) => Number(b.score) - Number(a.score) || a.roll.localeCompare(b.roll));
  const assigned = content.assignment_rules.reduce((sum, rule) => sum + rule.assigned_candidates, 0);
  const scores = rows.map((row) => Number(row.score));
  const maximum = rows[0] ? Number(rows[0].maximum_score) : 0;
  const average = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
  const stats = [
    { label: "Assigned", value: String(assigned) },
    { label: "Graded", value: String(rows.length) },
    { label: "Average", value: scores.length ? `${formatScoreText(average)} / ${formatScoreText(maximum)}` : "-" },
    { label: "Highest", value: scores.length ? `${formatScoreText(Math.max(...scores))} / ${formatScoreText(maximum)}` : "-" },
  ];

  return (
    <>
      <Link href={`/staff/exams/${examId}`} className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        {version.title}
      </Link>
      <PageHeader
        title="Results"
        description="Each question counts its best submission. Results appear once an attempt is graded."
        actions={
          rows.length > 0 && (
            <>
              <Button asChild variant="secondary" size="sm">
                <Link href={`/staff/exams/${examId}/similarity`}>
                  <ScanSearch />
                  Similarity
                </Link>
              </Button>
              <ExportButton
              filename={`${version.title.replace(/[^A-Za-z0-9]+/g, "-")}-results.csv`}
              rows={[
                ["roll_number", "score", "maximum_score", "status", "submitted_at"],
                ...rows.map((row) => [row.roll, row.score, row.maximum_score, row.lifecycle_state, row.submitted_at ?? ""]),
              ]}
              />
            </>
          )
        }
      />
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((stat) => (
          <Panel key={stat.label} className="px-4 py-3.5">
            <p className="text-xs text-ink-muted">{stat.label}</p>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">{stat.value}</p>
          </Panel>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState>No graded attempts yet.</EmptyState>
      ) : (
        <Table head={["Roll number", "Score", "Status", "Submitted"]}>
          {rows.map((row) => (
            <tr key={row.attempt_id}>
              <td className="px-4 py-2.5 font-mono text-[13px] text-ink">{row.roll}</td>
              <td className="px-4 py-2.5 font-mono tabular-nums text-ink">
                {formatScoreText(Number(row.score))} / {formatScoreText(Number(row.maximum_score))}
              </td>
              <td className="px-4 py-2.5">
                <Badge tone={row.lifecycle_state === "graded" ? "success" : "neutral"}>{row.lifecycle_state}</Badge>
              </td>
              <td className="px-4 py-2.5 text-ink-muted">{row.submitted_at ? formatDateTime(row.submitted_at) : "-"}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
