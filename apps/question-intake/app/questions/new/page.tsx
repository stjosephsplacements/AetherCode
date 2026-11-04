import type { Metadata } from "next";
import { QuestionEditor } from "@/components/editor";
import { Shell } from "@/components/shell";
import { listTopics } from "@/lib/data";
import { blankDraft } from "@/lib/draft";
import { DIFFICULTIES, type Difficulty } from "@/lib/platform";
import { requireViewer } from "@/lib/session";

export const metadata: Metadata = { title: "New question" };

export default async function NewQuestion({ searchParams }: { searchParams: Promise<{ topic?: string; difficulty?: string }> }) {
  const { viewer } = await requireViewer();
  const { topic = "", difficulty = "" } = await searchParams;
  const topics = await listTopics();
  const level = (DIFFICULTIES as readonly string[]).includes(difficulty) ? (difficulty as Difficulty) : "easy";
  return (
    <Shell viewer={viewer}>
      <h1 className="mb-5 text-[26px] font-semibold tracking-tight">New question</h1>
      <QuestionEditor id={null} initial={blankDraft(topics.some((entry) => entry.id === topic) ? topic : "", level)} topics={topics.map(({ id, name, parent_id }) => ({ id, name, parent_id }))} canDelete={false} />
    </Shell>
  );
}
