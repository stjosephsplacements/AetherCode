import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Panel } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requireViewer } from "@/lib/server/session";
import { gateway } from "@/lib/server/gateway";
import type { PracticeProgress } from "@/lib/api-types";
import { listMyAttempts } from "@/lib/server/attempts";
import { Award, Code, TrendingUp } from "lucide-react";

export const metadata: Metadata = { title: "Performance Analysis" };

export default async function PerformancePage() {
  const viewer = await requireViewer();
  if (!viewer.tenantId) redirect("/student");

  const [attempts, practice] = await Promise.all([
    listMyAttempts(viewer.tenantId).catch(() => []),
    gateway<PracticeProgress>(`/question-bank/v1/tenants/${viewer.tenantId}/practice/progress`).catch(() => null),
  ]);

  const completed = attempts.filter((a) => ["submitted", "grading", "graded"].includes(a.lifecycle_state));

  return (
    <div className="animate-enter space-y-8">
      <div>
        <span className="eyebrow text-brand">ANALYTICS & METRICS</span>
        <h1 className="display mt-1 text-[2.25rem] text-ink sm:text-[2.6rem]">Performance Analysis</h1>
        <p className="mt-2 text-[15px] text-ink-muted">
          Continuous tracking of your coding competencies, test consistency, and skill milestones.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Panel className="p-5 border-line bg-surface/70">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-brand/10 text-brand">
              <Award className="size-5" />
            </div>
            <div>
              <p className="text-xs text-ink-muted">Assessments Completed</p>
              <p className="font-mono text-2xl font-bold text-ink">{completed.length}</p>
            </div>
          </div>
        </Panel>

        <Panel className="p-5 border-line bg-surface/70">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-brand-soft text-brand-soft-ink">
              <Code className="size-5" />
            </div>
            <div>
              <p className="text-xs text-ink-muted">Problems Solved</p>
              <p className="font-mono text-2xl font-bold text-ink">{practice?.solved ?? 0}</p>
            </div>
          </div>
        </Panel>

        <Panel className="p-5 border-line bg-surface/70">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-success-soft text-success">
              <TrendingUp className="size-5" />
            </div>
            <div>
              <p className="text-xs text-ink-muted">Practice Completion</p>
              <p className="font-mono text-2xl font-bold text-ink">
                {practice && practice.available > 0 ? `${Math.round(((practice.solved || 0) / practice.available) * 100)}%` : "0%"}
              </p>
            </div>
          </div>
        </Panel>
      </div>

      <Panel className="p-6 border-line bg-surface/80">
        <h2 className="text-base font-semibold text-ink">Practice Breakdown</h2>
        <p className="text-xs text-ink-muted mt-1">Detailed evaluation across core programming paradigms.</p>
        
        <div className="mt-6 space-y-4">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="font-medium text-ink">Problem Solving & Algorithms</span>
              <span className="font-mono text-ink-muted">{practice?.solved ?? 0} solved</span>
            </div>
            <div className="h-2 w-full rounded-full bg-hover overflow-hidden">
              <div 
                className="h-full bg-brand transition-all duration-500" 
                style={{ width: `${Math.min(100, Math.max(5, ((practice?.solved || 0) / (practice?.available || 1)) * 100))}%` }} 
              />
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-end">
          <Button asChild variant="secondary" size="sm">
            <Link href="/student/progress">View Detailed Timeline →</Link>
          </Button>
        </div>
      </Panel>
    </div>
  );
}
