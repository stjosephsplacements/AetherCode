import { BookOpen, CheckCircle, Code, GraduationCap, Trophy } from "lucide-react";
import Link from "next/link";
import { Panel } from "@/components/ui/card";
import type { PracticeProgress } from "@/lib/api-types";

export function OverviewMetrics({
  progress,
  examCount,
  linkedCount,
}: {
  progress: PracticeProgress | null;
  examCount: number;
  linkedCount: number;
}) {
  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-3">
      {/* Practice card */}
      <Panel className="p-5 flex items-center justify-between border-line bg-surface/70">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Practice Solved</span>
          <p className="mt-1 font-mono text-3xl font-bold tracking-tight text-brand">
            {progress?.solved ?? 0}
            <span className="text-xs font-normal text-ink-muted ml-1.5 font-sans">/ {progress?.available ?? 0}</span>
          </p>
          <Link href="/student/practice" className="mt-2 text-xs text-brand font-medium hover:underline inline-block">
            Continue practicing →
          </Link>
        </div>
        <div className="grid size-10 place-items-center rounded-xl bg-brand/10 text-brand">
          <Code className="size-5" />
        </div>
      </Panel>

      {/* Exams scheduled */}
      <Panel className="p-5 flex items-center justify-between border-line bg-surface/70">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Tests & Exams</span>
          <p className="mt-1 font-mono text-3xl font-bold tracking-tight text-ink">{examCount}</p>
          <span className="mt-2 text-xs text-ink-muted inline-block">Assigned to your batch</span>
        </div>
        <div className="grid size-10 place-items-center rounded-xl bg-ink/5 text-ink">
          <BookOpen className="size-5" />
        </div>
      </Panel>

      {/* Profiles & Readiness */}
      <Panel className="p-5 flex items-center justify-between border-line bg-surface/70">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Linked Accounts</span>
          <p className="mt-1 font-mono text-3xl font-bold tracking-tight text-ink">{linkedCount}</p>
          <Link href="/student/profile" className="mt-2 text-xs text-brand font-medium hover:underline inline-block">
            Manage profiles →
          </Link>
        </div>
        <div className="grid size-10 place-items-center rounded-xl bg-success-soft text-success">
          <Trophy className="size-5" />
        </div>
      </Panel>
    </div>
  );
}
