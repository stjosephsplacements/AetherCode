import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PracticeWorkspace } from "@/components/practice/practice-workspace";
import type { PracticeQuestion } from "@/lib/api-types";
import { gateway } from "@/lib/server/gateway";
import { requireViewer } from "@/lib/server/session";

export const metadata: Metadata = { title: "Practice" };

// Full-screen, outside the student shell, like the exam screen.
export default async function PracticeProblemPage({ params }: { params: Promise<{ questionId: string }> }) {
  const { questionId } = await params;
  const viewer = await requireViewer();
  if (!viewer.tenantId) redirect("/student");
  const question = await gateway<PracticeQuestion>(`/question-bank/v1/tenants/${viewer.tenantId}/practice/questions/${questionId}`).catch(() => null);
  if (!question) notFound();
  return <PracticeWorkspace tenantId={viewer.tenantId} question={question} />;
}
