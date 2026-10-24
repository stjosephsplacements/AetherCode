import { BookOpen, CheckCircle, Code, GraduationCap, Trophy, Sparkles } from "lucide-react";
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
      <Panel className="relative overflow-hidden p-6 border-line bg-surface/80 backdrop-blur-sm transition-all duration-200 hover:border-brand/40 hover:shadow-md">
        <div className="flex items-start justify-between">
          <div>
            <span className="eyebrow text-brand">DEVELOPER BENCHMARK</span>
            <p className="mt-2 font-mono text-3xl font-bold tracking-tight text-ink">
              {progress?.solved ?? 0}
              <span className="text-xs font-normal text-ink-muted ml-2 font-sans">/ {progress?.available ?? 0} solved</span>
            </p>
            <Link href="/student/practice" className="mt-3 text-xs text-brand font-medium hover:underline inline-flex items-center gap-1">
              Continue practicing <span>→</span>
            </Link>
          </div>
          <div className="grid size-10 place-items-center rounded-xl bg-brand/10 text-brand">
            <Code className="size-5" />
          </div>
        </div>
      </Panel>

      {/* Exams scheduled */}
      <Panel className="relative overflow-hidden p-6 border-line bg-surface/80 backdrop-blur-sm transition-all duration-200 hover:border-brand/40 hover:shadow-md">
        <div className="flex items-start justify-between">
          <div>
            <span className="eyebrow text-ink-muted">ASSESSMENTS</span>
            <p className="mt-2 font-mono text-3xl font-bold tracking-tight text-ink">{examCount}</p>
            <span className="mt-3 text-xs text-ink-muted inline-block">Assigned by faculty</span>
          </div>
          <div className="grid size-10 place-items-center rounded-xl bg-hover text-ink">
            <BookOpen className="size-5" />
          </div>
        </div>
      </Panel>

      {/* Profiles & Readiness */}
      <Panel className="relative overflow-hidden p-6 border-line bg-surface/80 backdrop-blur-sm transition-all duration-200 hover:border-brand/40 hover:shadow-md">
        <div className="flex items-start justify-between">
          <div>
            <span className="eyebrow text-success">CAREER PROFILES</span>
            <p className="mt-2 font-mono text-3xl font-bold tracking-tight text-ink">{linkedCount}</p>
            <Link href="/student/profile" className="mt-3 text-xs text-brand font-medium hover:underline inline-flex items-center gap-1">
              Manage accounts <span>→</span>
            </Link>
          </div>
          <div className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand-soft-ink">
            <Trophy className="size-5" />
          </div>
        </div>
      </Panel>
    </div>
  );
}
