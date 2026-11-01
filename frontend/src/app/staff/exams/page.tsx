import type { Metadata } from "next";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { CollegeBar } from "@/components/staff/college-bar";
import { LiveRefresh } from "@/lib/client/realtime";
import { type ExamWithVersion, listAllExams, listExams } from "@/lib/server/exams";
import { requireCollege } from "@/lib/server/staff";
import { ExamBoard } from "./exam-board";
import { NewExamDialog } from "./new-exam-dialog";

export const metadata: Metadata = { title: "Exams" };

export default async function ExamsPage() {
  const staff = await requireCollege();
  const renderedAt = new Date().getTime();
  let exams: (ExamWithVersion & { college?: { id: string; name: string } })[];
  try {
    exams = staff.viewAll ? await listAllExams(staff.tenants) : await listExams(staff.tenantId);
  } catch (error) {
    return (
      <>
        <CollegeBar staff={staff} allowAll />
      <PageHeader title="Exams" />
        <LoadError error={error} />
      </>
    );
  }
  return (
    <>
      <LiveRefresh topics={["attempts"]} />
      <CollegeBar staff={staff} allowAll />
      <PageHeader
        title="Exams"
        description="Build an exam from published questions, publish it, then assign it to a batch, a department or a placement department. Click an exam for its quick view."
        actions={<NewExamDialog colleges={staff.viewAll ? staff.tenants.map((tenant) => ({ id: tenant.id, name: tenant.display_name })) : undefined} />}
      />
      <ExamBoard exams={exams.map(({ exam, version, college }) => ({ exam: { id: exam.id, created_at: exam.created_at }, version, college }))} renderedAt={renderedAt} />
    </>
  );
}
