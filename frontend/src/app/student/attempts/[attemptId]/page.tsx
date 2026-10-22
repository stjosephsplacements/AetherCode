import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ExamScreen } from "@/components/exam/exam-screen";
import { requireViewer } from "@/lib/server/session";

export const metadata: Metadata = { title: "Exam in progress" };

// Full-screen, outside the student shell. Everything here is fetched by the
// browser (see ExamScreen), because Safe Exam Browser signs each request.
export default async function AttemptPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const viewer = await requireViewer();
  if (!viewer.tenantId) redirect("/student");
  return <ExamScreen tenantId={viewer.tenantId} attemptId={attemptId} />;
}
