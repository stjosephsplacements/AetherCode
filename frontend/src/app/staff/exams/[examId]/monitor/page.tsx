import { ArrowLeft } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { panel } from "@/app/admin/_dashboard/panel";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { cn } from "@/lib/utils";
import type { AccountSummary, ExamMonitor } from "@/lib/api-types";
import { authorName } from "@/lib/author-name";
import { latestVersion } from "@/lib/server/exams";
import { gateway } from "@/lib/server/gateway";
import { describeAccounts } from "@/lib/server/people";
import { requireCollege } from "@/lib/server/staff";
import { listAllStudents } from "@/lib/server/students";
import { formatWindow } from "@/lib/utils";
import { MonitorBoard } from "./monitor-board";
import { ProctorGrid } from "./proctor-grid";

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
      <div className="animate-enter">
        <PageHeader title="Live monitor" />
        <LoadError error={error} />
      </div>
    );
  }
  const { version, monitor, students } = data;
  const rollNumber = Object.fromEntries(students.map((student) => [student.principal_id, student.enrollment_number]));
  const announcerIds = monitor.announcements.map((note) => note.created_by).filter((id): id is string => Boolean(id));
  const named = announcerIds.length
    ? await describeAccounts(staff.tenantId, announcerIds).catch(() => new Map<string, AccountSummary>())
    : new Map<string, AccountSummary>();
  const authorNames = Object.fromEntries(announcerIds.map((id) => [id, authorName(named, id)]));

  return (
    <div className="animate-enter">
      <Link href={`/staff/exams/${examId}`} className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" />
        {version.title}
      </Link>
      <PageHeader title="Live monitor" description={`${formatWindow(version.opens_at, version.closes_at)}. Updates in real time.`} />
      <section className={cn(panel, "mt-6 gap-4 p-5")}>
        <MonitorBoard examId={examId} versionId={version.id} monitor={monitor} rollNumber={rollNumber} authorNames={authorNames} />
      </section>
      <section className={cn(panel, "mt-4 gap-4 p-5")}>
        <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Proctor grid</h2>
        <ProctorGrid tenantId={staff.tenantId} versionId={version.id} rollNumber={rollNumber} />
      </section>
    </div>
  );
}
