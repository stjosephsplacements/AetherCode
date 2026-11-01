import { Badge } from "@/components/ui/card";
import type { GradingQueue, QueueStats } from "@/lib/api-types";
import { cn } from "@/lib/utils";

const seconds = (value: number | null) => (value === null ? "-" : value < 60 ? `${value.toFixed(1)} s` : `${Math.round(value / 60)} min`);

/** Waiting work turns amber after a minute and red after five. */
export function queueTone(oldestSeconds: number): "success" | "warning" | "danger" {
  return oldestSeconds > 300 ? "danger" : oldestSeconds > 60 ? "warning" : "success";
}

/** Share of the last hour's verdicts that failed, or null when there were none. */
export function failureRate(stats: Pick<QueueStats, "completed_last_hour" | "failed_last_hour">): number | null {
  const total = stats.completed_last_hour + stats.failed_last_hour;
  return total === 0 ? null : stats.failed_last_hour / total;
}

function Queue({ title, note, stats, now }: { title: string; note: string; stats: QueueStats; now: string }) {
  const waiting = stats.queued + stats.dispatched;
  const oldest = stats.oldest_waiting_at ? (Date.parse(now) - Date.parse(stats.oldest_waiting_at)) / 1000 : 0;
  const failed = failureRate(stats);
  const metrics: [string, string, boolean?][] = [
    ["Waiting", String(stats.queued)],
    ["Running", String(stats.dispatched)],
    ["Oldest wait", waiting ? seconds(oldest) : "-"],
    ["Done / h", String(stats.completed_last_hour)],
    ["Failed / h", String(stats.failed_last_hour), stats.failed_last_hour > 0],
    ["Failure rate", failed === null ? "-" : `${(failed * 100).toFixed(failed < 0.1 ? 1 : 0)}%`, failed !== null && failed >= 0.05],
    ["Per minute", (stats.completed_last_hour / 60).toFixed(1)],
    ["Median", seconds(stats.median_seconds_last_hour)],
    ["p95", seconds(stats.p95_seconds_last_hour)],
  ];
  return (
    <div className="rounded-[var(--radius-control)] border border-line p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{title}</p>
          <p className="text-[12.5px] text-ink-muted">{note}</p>
        </div>
        <Badge tone={queueTone(oldest)}>{waiting === 0 ? "Idle" : `${waiting} waiting`}</Badge>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-x-4 gap-y-3">
        {metrics.map(([label, value, alert]) => (
          <div key={label}>
            <dt className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-subtle">{label}</dt>
            <dd className={cn("mt-0.5 font-mono text-sm tabular-nums", alert ? "text-warning" : "text-ink")}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** How the judge is doing for one college: both queues, from the grading-queue API. */
export function JudgeMetrics({ queue }: { queue: GradingQueue }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Queue title="Submissions" note="Per-question submits and end-of-test grading" stats={queue.evaluations} now={queue.checked_at} />
      <Queue title="Sample runs" note="Run code on the exam screen" stats={queue.runs} now={queue.checked_at} />
    </div>
  );
}
