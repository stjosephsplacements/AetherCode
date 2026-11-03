import type { Metadata } from "next";
import { QuestionEditor } from "@/components/editor";
import { emptyDraft } from "@/lib/draft";
import { Shell } from "@/components/shell";
import { requireViewer } from "@/lib/session";

export const metadata: Metadata = { title: "New question" };

export default async function NewQuestion() {
  const { viewer } = await requireViewer();
  return (
    <Shell viewer={viewer}>
      <h1 className="mb-5 text-[26px] font-semibold tracking-tight">New question</h1>
      <QuestionEditor id={null} initial={emptyDraft()} canDelete={false} />
    </Shell>
  );
}
