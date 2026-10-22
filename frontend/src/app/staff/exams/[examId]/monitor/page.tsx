import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import type { ExamMonitor } from "@/lib/api-types";
import { latestVersion } from "@/lib/server/exams";
import { gateway } from "@/lib/server/gateway";
import { requireCollege } from "@/lib/server/staff";
import { listAllStudents } from "@/lib/server/students";
import { formatWindow } from "@/lib/utils";
import { MonitorBoard } from "./monitor-board";

export const metadata: Metadata = { title: "Live monitor" };

export default async function MonitorPage({ params }: { params: Promise<{ examId: string }> }) {
  const staff = await requireCollege();
  const { examId } = await params;
  let data;
  try {
    const version = await latestVersion(staff.tenantId, examId);
    if (!version) throw new Error("This exam has no version.");
    const [monitor, students] = await Promise.all([
      gateway<ExamMonitor>(`/submission/v1/tenants/${staff.tenantId}/exam-versions/${version.id}/monitor`),
      listAllStudents(staff.tenantId),
    ]);
    data = { version, monitor, students };
  } catch (error) {
    return (
      <>
        <PageHeader title="Live monitor" />
        <LoadError error={error} />
      </>
    );
  }
  const { version, monitor, students } = data;
  const rollNumber = Object.fromEntries(students.map((student) => [student.principal_id, student.enrollment_number]));

  return (
    <>
      <Link href={`/staff/exams/${examId}`} className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        {version.title}
      </Link>
      <PageHeader title="Live monitor" description={`${formatWindow(version.opens_at, version.closes_at)}. Refreshes every 15 seconds.`} />
      <MonitorBoard examId={examId} versionId={version.id} monitor={monitor} rollNumber={rollNumber} />
    </>
  );
}
