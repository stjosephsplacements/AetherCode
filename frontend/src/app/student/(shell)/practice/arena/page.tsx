import { Timer } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/staff/page-header";
import type { PracticeProblem } from "@/lib/api-types";
import { gateway } from "@/lib/server/gateway";
import { requireViewer } from "@/lib/server/session";
import { PracticeList } from "../practice-list";

export const metadata: Metadata = { title: "Practice arena" };

function arenaProblems(problems: PracticeProblem[]) {
  return problems.filter((problem) => problem.tags.some((tag) => tag === "arena" || tag.startsWith("arena:")));
}

export default async function PracticeArenaPage() {
  const viewer = await requireViewer();
  if (!viewer.tenantId) redirect("/student");
  const problems = await gateway<PracticeProblem[]>(`/question-bank/v1/tenants/${viewer.tenantId}/practice/questions`);
  const arena = arenaProblems(problems);

  return (
    <div className="animate-enter">
      <PageHeader
        title="Practice arena"
        description="Timed session over arena-tagged problems. Staff tag questions with arena or arena:sql for SQLite drills."
      />
      <motion-note />
      {arena.length === 0 ? (
        <p className="rounded-panel border border-dashed border-line-strong px-6 py-14 text-center text-sm text-ink-muted">
          No arena problems yet. Ask faculty to tag practice questions with <span className="font-mono text-ink">arena</span>.
        </p>
      ) : (
        <PracticeList problems={arena} />
      )}
      <Link href="/student/practice" className="mt-8 inline-block text-sm text-brand hover:underline">
        Back to all practice
      </Link>
    </div>
  );
}

function motion-note() {
  return (
    <p className="mb-6 flex items-center gap-2 rounded-panel border border-line bg-brand-soft/40 px-4 py-3 text-[13px] text-ink-muted">
      <Timer className="size-4 shrink-0 text-brand" />
      Suggested pace: 45 minutes for the set below. The timer is on your honour; nothing is submitted automatically.
    </p>
  );
}