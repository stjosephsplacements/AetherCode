import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/server/session";
import { AttemptStatus } from "./attempt-status";

export const metadata: Metadata = { title: "Submitted" };

export default async function ResultPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const viewer = await requireViewer();
  if (!viewer.tenantId) redirect("/student");
  return <AttemptStatus tenantId={viewer.tenantId} attemptId={attemptId} />;
}
