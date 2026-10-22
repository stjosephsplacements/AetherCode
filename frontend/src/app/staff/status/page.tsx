import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader, Section, Table } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import type { GradingQueue, QueueStats } from "@/lib/api-types";
import { gateway } from "@/lib/server/gateway";
import { requireStaff } from "@/lib/server/staff";
import { formatTime } from "@/lib/utils";

export const metadata: Metadata = { title: "System status" };

/** What each service does, as staff would describe it. */
const SERVICES = [
  ["identity", "Sign-in and passwords"],
  ["tenant", "Colleges, departments and batches"],
  ["user", "Accounts, students and permissions"],
  ["question-bank", "Questions and test cases"],
  ["assessment", "Exams and assignments"],
  ["submission", "Attempts, runs and grading"],
  ["seb", "Safe Exam Browser lockdown"],
  ["notification", "Notifications"],
  ["analytics", "Results and reports"],
] as const;

type Check = { service: string; purpose: string; ready: boolean; milliseconds: number };

/** A service is ready when it and its database answer; readiness carries nothing else. */
async function check(service: string, purpose: string): Promise<Check> {
  const started = performance.now();
  const ready = await gateway(`/${service}/readyz`).then(
    () => true,
    () => false,
  );
  return { service, purpose, ready, milliseconds: Math.round(performance.now() - started) };
}

export default async function StatusPage() {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) redirect("/staff");
  const [checks, queue] = await Promise.all([
    Promise.all(SERVICES.map(([service, purpose]) => check(service, purpose))),
    staff.tenantId ? gateway<GradingQueue>(`/submission/v1/tenants/${staff.tenantId}/grading-queue`).catch(() => null) : null,
  ]);
  const down = checks.filter((entry) => !entry.ready);

  return (
    <>
      <PageHeader
        title="System status"
        description={`Checked ${formatTime(new Date())}. Reload to check again. The code-execution engine is checked by grading itself: a run that never finishes shows on the exam screen.`}
        actions={<Badge tone={down.length ? "danger" : "success"}>{down.length ? `${down.length} not ready` : "All services ready"}</Badge>}
      />
      <Table head={["Service", "What it does", "Status", "Response"]}>
        {checks.map((entry) => (
          <tr key={entry.service}>
            <td className="px-4 py-2.5 font-mono text-[13px] text-ink">{entry.service}</td>
            <td className="px-4 py-2.5 text-ink-muted">{entry.purpose}</td>
            <td className="px-4 py-2.5">
              <Badge tone={entry.ready ? "success" : "danger"}>{entry.ready ? "Ready" : "Not ready"}</Badge>
            </td>
            <td className="px-4 py-2.5 font-mono tabular-nums text-ink-muted">{entry.milliseconds} ms</td>
          </tr>
        ))}
      </Table>
      {queue && (
        <Section title="Grading queue" description="Code waiting for the judge in this college, and how fast verdicts came back in the last hour.">
          <div className="grid gap-3 md:grid-cols-2">
            <QueuePanel title="Submissions" note="Per-question submits and end-of-test grading" stats={queue.evaluations} now={queue.checked_at} />
            <QueuePanel title="Sample runs" note="Run code on the exam screen" stats={queue.runs} now={queue.checked_at} />
          </div>
        </Section>
      )}
    </>
  );
}

const seconds = (value: number | null) => (value === null ? "-" : value < 60 ? `${value.toFixed(1)} s` : `${Math.round(value / 60)} min`);

/** Waiting work turns amber after a minute and red after five. */
function QueuePanel({ title, note, stats, now }: { title: string; note: string; stats: QueueStats; now: string }) {
  const waiting = stats.queued + stats.dispatched;
  const oldest = stats.oldest_waiting_at ? (Date.parse(now) - Date.parse(stats.oldest_waiting_at)) / 1000 : 0;
  const tone = oldest > 300 ? "danger" : oldest > 60 ? "warning" : "success";
  return (
    <div className="rounded-[var(--radius-surface)] border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-ink">{title}</p>
          <p className="text-[13px] text-ink-muted">{note}</p>
        </div>
        <Badge tone={tone}>{waiting === 0 ? "Idle" : `${waiting} waiting`}</Badge>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        {[
          ["Waiting for a worker", String(stats.queued)],
          ["Running now", String(stats.dispatched)],
          ["Oldest wait", waiting ? seconds(oldest) : "-"],
          ["Finished, last hour", String(stats.completed_last_hour)],
          ["Failed, last hour", String(stats.failed_last_hour)],
          ["Verdict time, median / p95", `${seconds(stats.median_seconds_last_hour)} / ${seconds(stats.p95_seconds_last_hour)}`],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="font-mono tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
