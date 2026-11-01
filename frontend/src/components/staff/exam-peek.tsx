import { ArrowUpRight, BarChart3, Eye, MonitorPlay } from "lucide-react";
import Link from "next/link";
import { ConfirmDelete } from "@/components/staff/confirm-delete";
import { deleteExam } from "@/app/staff/exams/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { ExamVersion } from "@/lib/api-types";
import { collegeHref } from "@/lib/links";
import { cn, formatDuration, formatWindow } from "@/lib/utils";

export const STATE_LABEL = { draft: "Draft", live: "Live now", next: "Scheduled", closed: "Closed" } as const;

export function examState(version: ExamVersion, now: number): "draft" | "live" | "next" | "closed" {
  if (version.status !== "published") return "draft";
  return Date.parse(version.closes_at) <= now ? "closed" : Date.parse(version.opens_at) <= now ? "live" : "next";
}

/** Clicking an exam anywhere on the dashboard opens this, not a new page. */
export function ExamPeek({ exam, now, className, children, label }: { exam: { exam: { id: string }; version: ExamVersion; college?: { id: string; name: string } }; now: number; className?: string; children: React.ReactNode; label?: string }) {
  const { version } = exam;
  const state = examState(version, now);
  const id = exam.exam.id;
  return (
    <Dialog>
      <DialogTrigger aria-label={label} className={cn("text-left", className)}>
        {children}
      </DialogTrigger>
      <DialogContent title={version.title} description={formatWindow(version.opens_at, version.closes_at)}>
        <div className="space-y-5 p-6">
          <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-[var(--radius-control)] border border-line bg-line">
            {[
              ["State", STATE_LABEL[state]],
              ["Duration", formatDuration(version.duration_seconds)],
              ["Version", `v${version.version_number}`],
            ].map(([term, value]) => (
              <div key={term} className="bg-surface px-4 py-3">
                <dt className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-subtle">{term}</dt>
                <dd className={cn("mt-1 text-sm font-medium", term === "State" && state === "live" ? "text-brand" : "text-ink")}>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={collegeHref(`/staff/exams/${id}`, exam.college?.id)}>
                Open exam
                <ArrowUpRight />
              </Link>
            </Button>
            {(state === "live" || state === "closed") && (
              <Button asChild variant="secondary">
                <Link href={collegeHref(`/staff/exams/${id}/monitor`, exam.college?.id)}>
                  <MonitorPlay />
                  Monitor
                </Link>
              </Button>
            )}
            {state === "closed" && (
              <Button asChild variant="secondary">
                <Link href={collegeHref(`/staff/exams/${id}/results`, exam.college?.id)}>
                  <BarChart3 />
                  Results
                </Link>
              </Button>
            )}
            <Button asChild variant="ghost">
              <Link href={collegeHref(`/staff/exams/${id}/preview`, exam.college?.id)}>
                <Eye />
                Preview
              </Link>
            </Button>
            {state === "draft" && !exam.college && (
              <ConfirmDelete
                label="Delete exam"
                title={`Delete ${version.title}?`}
                description="It has never been published. A published exam cannot be deleted."
                confirmText={version.title}
                onConfirm={(reason) => deleteExam(id, reason)}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
