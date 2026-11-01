import type { Metadata } from "next";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { LiveRefresh } from "@/lib/client/realtime";
import { type ExamWithVersion, listExams } from "@/lib/server/exams";
import { requireCollege } from "@/lib/server/staff";
import { ExamBoard } from "./exam-board";
import { NewExamDialog } from "./new-exam-dialog";

export const metadata: Metadata = { title: "Exams" };

export default async function ExamsPage() {
  const staff = await requireCollege();
  const renderedAt = new Date().getTime();
  let exams: ExamWithVersion[];
  try {
    exams = await listExams(staff.tenantId);
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
        description="Build an exam from published questions, publish it, then assign it to a batch, a department or a placement department. Click an exam for its quick view."
        actions={<NewExamDialog />}
      />
      <ExamBoard exams={exams.map(({ exam, version }) => ({ exam: { id: exam.id, created_at: exam.created_at }, version }))} renderedAt={renderedAt} />
    </>
  );
}
