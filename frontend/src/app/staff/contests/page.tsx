import type { Metadata } from "next";
import { panel } from "@/app/admin/_dashboard/panel";
import { PageHeader } from "@/components/staff/page-header";
import type { PracticeProblem } from "@/lib/api-types";
import { gateway } from "@/lib/server/gateway";
import { collegeFor, requireStaff } from "@/lib/server/staff";
import { cn, formatDateTime } from "@/lib/utils";
import { CreateContestForm } from "./form";

export const metadata: Metadata = { title: "College contests" };

type Contest = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  lifecycle: string;
  question_ids: string[];
};

export default async function StaffContestsPage() {
  const staff = await requireStaff();
  const collegeId = collegeFor(staff);
  const [contestsRaw, practiceRaw] = await Promise.all([
    gateway<Contest[] | { items?: Contest[] }>(`/question-bank/v1/tenants/${collegeId}/contests`).catch(() => [] as Contest[]),
    gateway<PracticeProblem[] | { items?: PracticeProblem[] }>(`/question-bank/v1/tenants/${collegeId}/practice/questions`).catch(
      () => [] as PracticeProblem[],
    ),
  ]);
  const contests = Array.isArray(contestsRaw) ? contestsRaw : Array.isArray(contestsRaw?.items) ? contestsRaw.items : [];
  const practice = Array.isArray(practiceRaw) ? practiceRaw : Array.isArray(practiceRaw?.items) ? practiceRaw.items : [];
  const questions = practice.map((row) => ({
    id: row.question_id,
    title: row.title,
    kind: row.kind,
    tags: row.tags,
  }));
  return (
    <div className="animate-enter space-y-6">
      <PageHeader title="College contests" description="Schedule timed practice contests for students in your college." />
      <CreateContestForm collegeId={collegeId} questions={questions} />
      <ul className="space-y-2">
        {contests.map((contest) => (
          <li key={contest.id} className={cn(panel, "p-4 text-sm")}>
            <p className="font-semibold text-ink">{contest.title}</p>
            <p className="text-xs text-ink-muted">
              {formatDateTime(contest.starts_at)} → {formatDateTime(contest.ends_at)} · {contest.lifecycle} · {contest.question_ids.length} problems
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}