import type { Metadata } from "next";
import { FigureCard } from "@/app/admin/_dashboard/charts";
import { examState } from "@/components/staff/exam-peek";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import type { AccountSummary } from "@/lib/api-types";
import { authorName } from "@/lib/author-name";
import { LiveRefresh } from "@/lib/client/realtime";
import { type ExamWithVersion, listExams } from "@/lib/server/exams";
import { describeAccounts } from "@/lib/server/people";
import { listPublishedPolicyVersions } from "@/lib/server/proctor-policies";
import { requireCollege } from "@/lib/server/staff";
import { ExamBoard } from "./exam-board";
import { NewExamDialog } from "./new-exam-dialog";

export const metadata: Metadata = { title: "Exams" };

export default async function ExamsPage() {
  const staff = await requireCollege();
  const renderedAt = new Date().getTime();
  let exams: (ExamWithVersion & { college?: { id: string; name: string } })[];
  try {
    exams = await listExams(staff.tenantId);
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="Exams" />
        <LoadError error={error} />
      </div>
    );
  }
  const policies = await listPublishedPolicyVersions(staff.tenantId).catch(() => []);
  const now = renderedAt;
  const states = exams.map((entry) => (entry.version ? examState(entry.version, now) : "draft"));
  const live = states.filter((state) => state === "live").length;
  const drafts = states.filter((state) => state === "draft").length;
  const scheduled = states.filter((state) => state === "next").length;
  const authorIds = exams.flatMap(({ exam, version }) => [exam.created_by, version?.created_by].filter((id): id is string => Boolean(id)));
  const names = authorIds.length
    ? await describeAccounts(staff.tenantId, authorIds).catch(() => new Map<string, AccountSummary>())
    : new Map<string, AccountSummary>();

  return (
    <div className="animate-enter">
      <LiveRefresh topics={["attempts"]} />
      <PageHeader
        title="Exams"
        description="Create exams, add questions, publish and assign to students. Click one to see details."
        actions={<NewExamDialog policies={policies} />}
      />

      <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FigureCard label="Exams" value={String(exams.length)} note="this college" />
        <FigureCard label="Live now" value={String(live)} note={live ? "window open" : "none running"} tone={live ? "warn" : "good"} />
        <FigureCard label="Scheduled" value={String(scheduled)} note="opens later" />
        <FigureCard label="Drafts" value={String(drafts)} note="not published" />
      </div>

      <ExamBoard
        exams={exams.map(({ exam, version, college }) => ({
          exam: { id: exam.id, created_at: exam.created_at },
          version,
          college,
          authorName: authorName(names, version?.created_by ?? exam.created_by),
        }))}
        renderedAt={renderedAt}
      />
    </div>
  );
}
