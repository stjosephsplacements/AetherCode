import { ArrowRight, Code2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/staff/page-header";
import { Ring } from "@/components/student/ring";
import type { PracticeProblem, PracticeProgress } from "@/lib/api-types";
import { gateway } from "@/lib/server/gateway";
import { requireViewer } from "@/lib/server/session";
import { cn } from "@/lib/utils";
import { topicsOf } from "./topics";
import { TopicGrid } from "./topic-grid";

export const metadata: Metadata = { title: "Practice" };

export default async function PracticePage() {
  const viewer = await requireViewer();
  if (!viewer.tenantId) redirect("/student");
  const base = `/question-bank/v1/tenants/${viewer.tenantId}/practice`;
  const [problems, progress] = await Promise.all([gateway<PracticeProblem[]>(`${base}/questions`), gateway<PracticeProgress>(`${base}/progress`).catch(() => null)]);
  const topics = topicsOf(problems);
  const next = problems.find((problem) => problem.attempted && !problem.solved) ?? problems.find((problem) => !problem.solved);
  const solved = problems.filter((problem) => problem.solved).length;
  const share = problems.length ? Math.round((solved / problems.length) * 100) : 0;

  return (
    <div className="animate-enter">
      <PageHeader title="Practice" description="Pick a topic, open a problem, run your code on the samples, then submit it against every test. Nothing here counts towards an exam." />
      <section className="mb-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-wrap items-center gap-6 rounded-3xl border border-line bg-surface p-6 shadow-[var(--shadow-panel)]">
          <Ring value={solved} max={problems.length} size={112} stroke={11}>
            <span className="font-mono text-[22px] font-semibold text-ink">{share}%</span>
          </Ring>
          <div>
            <p className="text-[13px] text-ink-muted">Your progress</p>
            <p className="mt-0.5 text-[26px] font-semibold tracking-[-0.02em] text-ink">
              {solved}
              <span className="text-ink-subtle"> / {problems.length} solved</span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-[12.5px]">
              {(["easy", "medium", "hard"] as const).map((level) => {
                const row = progress?.by_difficulty[level];
                return (
                  <span key={level} className={cn("rounded-full px-3 py-1 font-medium capitalize", level === "easy" ? "bg-success-soft text-success" : level === "medium" ? "bg-warning-soft text-warning" : "bg-danger-soft text-danger")}>
                    {level} {row?.solved ?? 0}/{row?.available ?? 0}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex flex-col justify-between rounded-3xl bg-gradient-to-br from-[#1b1640] via-[#5a210d] to-[#b84a0d] p-6 text-white shadow-[var(--shadow-panel)]">
          <div>
            <p className="text-[13px] text-white/85">{next ? (next.attempted ? "Pick up where you left off" : "Start with") : "All caught up"}</p>
            <p className="mt-1 line-clamp-2 text-[20px] font-semibold leading-snug">{next ? next.title : problems.length ? "You have solved every problem." : "No problems yet."}</p>
          </div>
          {next && (
            <Link href={`/student/practice/${next.question_id}`} className="mt-5 inline-flex h-11 w-fit items-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-[#1b1640] shadow-lg transition-transform hover:-translate-y-0.5">
              <Code2 className="size-4" />
              Solve it
              <ArrowRight className="size-4" />
            </Link>
          )}
        </div>
      </section>
      <TopicGrid topics={topics} />
    </div>
  );
}
