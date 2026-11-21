import type { Metadata } from "next";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { LiveRefresh } from "@/lib/client/realtime";
import { type ExamWithVersion, listExams } from "@/lib/server/exams";
import { listPublishedPolicyVersions } from "@/lib/server/proctor-policies";
import { requireCollege } from "@/lib/server/staff";
import { ExamBoard } from "./exam-board";
import { NewExamDialog } from "./new-exam-dialog";

export const metadata: Metadata = { title: "Exams" };

export default async function ExamsPage() {
  const staff = await requireCollege();
  const renderedAt = new Date().getTime();
  let exams: (ExamWithVersion & { college?: { id: string; name: string } })[];
  let policies: Awaited<ReturnType<typeof listPublishedPolicyVersions>> = [];
  try {
    [exams, policies] = await Promise.all([listExams(staff.tenantId), listPublishedPolicyVersions(staff.tenantId)]);
  } catch (error) {
    return (
      <>
        <PageHeader title="Exams" />
        <LoadError error={error} />
      </>
    );
  }
  return (
    <>
      <LiveRefresh topics={["attempts"]} />
      <PageHeader
        title="Exams"
        description="Create exams, add questions, publish and assign to students. Click one to see details."
        actions={<NewExamDialog policies={policies} />}
      />
      <ExamBoard exams={exams.map(({ exam, version, college }) => ({ exam: { id: exam.id, created_at: exam.created_at }, version, college }))} renderedAt={renderedAt} />
    </>
  );
}
