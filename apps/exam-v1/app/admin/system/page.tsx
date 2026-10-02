import { requireUser } from "@/lib/auth";
import { checkHealth } from "@/lib/health";
import { AppShell } from "@/components/app-shell";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const ago = (seconds: number | null) => (seconds === null ? "never" : seconds < 90 ? `${seconds}s ago` : `${Math.round(seconds / 60)} min ago`);

export default async function SystemPage() {
  const user = await requireUser("admin");
  const health = await checkHealth();
  const rows: Array<[string, boolean, string]> = [
    ["Database", health.database, health.database ? "connected" : "unreachable"],
    [
      "Grading worker",
      health.worker.ok,
      `${health.worker.workers} alive · last heartbeat ${ago(health.worker.lastSeenSeconds)}${health.worker.engine ? ` · ${health.worker.engine}` : ""}`,
    ],
    ["Code engine", health.engine.ok, health.engine.detail],
  ];
  const backlog = health.queue.oldestQueuedSeconds ?? 0;
  return (
    <AppShell user={user}>
      <AutoRefresh seconds={5} />
      <PageHeader eyebrow="Administration · refreshes every 5s" title="System status" />
      <Card className="mb-6 divide-y divide-line">
        {rows.map(([label, ok, detail]) => (
          <div key={label} className="flex items-center gap-4 px-5 py-4">
            <span className={`size-2.5 rounded-full ${ok ? "bg-go" : "bg-error"}`} />
            <span className="w-40 font-semibold">{label}</span>
            <span className="text-sm text-muted">{detail}</span>
            <span className="ml-auto">
              <Badge tone={ok ? "pass" : "error"}>{ok ? "OK" : "Down"}</Badge>
            </span>
          </div>
        ))}
      </Card>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ["Waiting to grade", health.queue.queued],
          ["Grading now", health.queue.running],
          ["Oldest waiting", health.queue.oldestQueuedSeconds === null ? "—" : `${health.queue.oldestQueuedSeconds}s`],
          ["Graded in last 5 min", health.queue.gradedLast5Min],
        ].map(([label, value]) => (
          <Card key={String(label)} className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-faint">{label}</p>
            <p className="mt-1 font-display text-2xl font-semibold tracking-tight">{value}</p>
          </Card>
        ))}
      </div>
      {backlog > 60 && (
        <p className="mt-6 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent">
          Submissions are waiting over a minute. Grading is behind; scores will catch up, but consider adding Judge0 workers (COUNT) or CPU.
        </p>
      )}
    </AppShell>
  );
}
