import { ArrowLeft } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import type { PracticeProblem } from "@/lib/api-types";
import { gateway } from "@/lib/server/gateway";
import { requireViewer } from "@/lib/server/session";
import { PracticeList } from "../../practice-list";

export const metadata: Metadata = { title: "Practice topic" };

export default async function TopicPage({ params }: { params: Promise<{ topic: string }> }) {
  const topic = decodeURIComponent((await params).topic);
  const viewer = await requireViewer();
  if (!viewer.tenantId) redirect("/student");
  let all: PracticeProblem[];
  try {
    all = await gateway<PracticeProblem[]>(`/question-bank/v1/tenants/${viewer.tenantId}/practice/questions`);
  } catch (error) {
    return <LoadError error={error} />;
  }
  const problems = topic === "all" ? all : all.filter((problem) => (problem.tags.length ? problem.tags.includes(topic) : topic === "general"));
  const title = topic === "all" ? "All problems" : topic.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
  return (
    <div className="animate-enter">
      <Link href="/student/practice" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-3.5" />
        All topics
      </Link>
      <PageHeader title={title} description={`${problems.filter((problem) => problem.solved).length} of ${problems.length} solved. Open a problem to read it and write your solution.`} />
      <PracticeList problems={problems} hideTopic={topic !== "all"} />
    </div>
  );
}
