import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { PracticeProblem, PracticeProgress } from "@/lib/api-types";
import { gateway } from "@/lib/server/gateway";
import { requireViewer } from "@/lib/server/session";
import { PracticeList } from "./practice-list";
import { SolvedBars } from "../progress/solved-bars";

export const metadata: Metadata = { title: "Practice" };

export default async function PracticePage() {
  const viewer = await requireViewer();
  if (!viewer.tenantId) redirect("/student");
  const base = `/question-bank/v1/tenants/${viewer.tenantId}/practice`;
  const [problems, progress] = await Promise.all([
    gateway<PracticeProblem[]>(`${base}/questions`),
    gateway<PracticeProgress>(`${base}/progress`).catch(() => null),
  ]);
  return (
    <div className="animate-enter">
      <h1 className="display text-[2.25rem] text-ink sm:text-[2.6rem]">Practice</h1>
      <p className="mt-2 max-w-[60ch] text-[15px] text-ink-muted">
        Problems your faculty set aside for practice. Run your code on the samples, then submit to check it against every test. Nothing here counts towards an exam.
      </p>
      {progress && progress.available > 0 && <SolvedBars progress={progress} className="mt-8" />}
      <PracticeList problems={problems} />
    </div>
  );
}
