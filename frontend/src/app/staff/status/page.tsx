import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { panel } from "@/app/admin/_dashboard/panel";
import { JudgeMetrics, failureRate, queueTone } from "@/components/staff/judge-metrics";
import { ServicesBadge } from "@/components/staff/live-services";
import ServicesBoard from "@/components/staff/services-board";
import { EmptyState, PageHeader } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import type { GradingQueue, Page, Tenant } from "@/lib/api-types";
import { LiveRefresh } from "@/lib/client/realtime";
import { gateway } from "@/lib/server/gateway";
import { serviceHealth } from "@/lib/server/status";
import { requireStaff } from "@/lib/server/staff";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "System status" };

export default async function StatusPage() {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) redirect("/staff");

  let tenantId = staff.tenantId;
  let probingFallback = false;
  if (!tenantId && staff.isPlatformAdmin) {
    const tenants = (await gateway<Page<Tenant>>("/tenant/v1/tenants?limit=100").catch(() => ({ items: [] as Tenant[] }))).items;
    tenantId = tenants.find((tenant) => tenant.status === "active")?.id ?? tenants[0]?.id ?? null;
    probingFallback = Boolean(tenantId);
  }

  const [health, queue] = await Promise.all([
    tenantId ? serviceHealth(tenantId).catch(() => null) : null,
    tenantId ? gateway<GradingQueue>(`/submission/v1/tenants/${tenantId}/grading-queue`).catch(() => null) : null,
  ]);

  const evalWaiting = queue ? queue.evaluations.queued + queue.evaluations.dispatched : 0;
  const runWaiting = queue ? queue.runs.queued + queue.runs.dispatched : 0;
  const evalFail = queue ? failureRate(queue.evaluations) : null;
  const runFail = queue ? failureRate(queue.runs) : null;
  const evalOldest = queue?.evaluations.oldest_waiting_at ? (Date.parse(queue.checked_at) - Date.parse(queue.evaluations.oldest_waiting_at)) / 1000 : 0;
  const ready = health?.services.filter((service) => service.ready).length ?? 0;
  const total = health?.services.length ?? 0;

  return (
    <div className="animate-enter space-y-6">
      <LiveRefresh topics={["grading"]} />
      <PageHeader
        title="System status"
        description={
          health
            ? `${ready}/${total} services ready${queue ? ` · ${evalWaiting + runWaiting} waiting on the judge` : ""}. Updates while this page is open.`
            : "Are the services up, and is the judge keeping up? This page updates while you leave it open."
        }
        actions={<ServicesBadge initial={health} />}
      />

      {!tenantId ? (
        <section className={cn(panel)}>
          <EmptyState>
            <p className="mb-2 text-[15px] font-medium text-ink">No college context</p>
            {staff.isPlatformAdmin ? (
              <>
                Open a college from{" "}
                <Link href="/admin/explore" className="text-brand hover:underline">
                  Explore
                </Link>{" "}
                to probe its services and judge queues.
              </>
            ) : (
              "Your account is not tied to a college yet."
            )}
          </EmptyState>
        </section>
      ) : (
        <>
          {probingFallback && (
            <section className={cn(panel, "border-dashed")}>
              <p className="text-[13.5px] text-ink-muted">
                Probing via a college context.{" "}
                <Link href="/admin/explore" className="font-medium text-brand hover:underline">
                  Pick another in Explore
                </Link>{" "}
                to change it.
              </p>
            </section>
          )}

          <ServicesBoard initial={health} />

          {queue ? (
            <section aria-label="Judge queue" className={cn(panel)}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Judge queue</h2>
                  <p className="mt-0.5 text-[13px] text-ink-muted">How fast verdicts came back in the last hour for this college.</p>
                </div>
                <Badge tone={queueTone(evalOldest)}>
                  {evalWaiting + runWaiting === 0 ? "Idle" : `${evalWaiting + runWaiting} waiting`}
                </Badge>
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 sm:grid-cols-4">
                <div>
                  <dt className="text-[12px] text-ink-muted">Submissions waiting</dt>
                  <dd className="mt-0.5 font-mono text-[18px] font-semibold tabular-nums tracking-[-0.02em] text-ink">{evalWaiting}</dd>
                  <p className="mt-0.5 text-[11.5px] text-ink-subtle">
                    {queue.evaluations.queued} queued · {queue.evaluations.dispatched} running
                  </p>
                </div>
                <div>
                  <dt className="text-[12px] text-ink-muted">Sample runs waiting</dt>
                  <dd className="mt-0.5 font-mono text-[18px] font-semibold tabular-nums tracking-[-0.02em] text-ink">{runWaiting}</dd>
                  <p className="mt-0.5 text-[11.5px] text-ink-subtle">
                    {queue.runs.queued} queued · {queue.runs.dispatched} running
                  </p>
                </div>
                <div>
                  <dt className="text-[12px] text-ink-muted">Graded (1 h)</dt>
                  <dd className="mt-0.5 font-mono text-[18px] font-semibold tabular-nums tracking-[-0.02em] text-ink">{queue.evaluations.completed_last_hour}</dd>
                  <p className="mt-0.5 text-[11.5px] text-ink-subtle">
                    {queue.evaluations.failed_last_hour ? `${queue.evaluations.failed_last_hour} failed` : "no failures"}
                  </p>
                </div>
                <div>
                  <dt className="text-[12px] text-ink-muted">Failure rate</dt>
                  <dd className="mt-0.5 font-mono text-[18px] font-semibold tabular-nums tracking-[-0.02em] text-ink">
                    {evalFail === null ? "—" : `${(evalFail * 100).toFixed(evalFail < 0.1 ? 1 : 0)}%`}
                  </dd>
                  <p className="mt-0.5 text-[11.5px] text-ink-subtle">
                    {runFail === null ? "sample runs quiet" : `runs ${(runFail * 100).toFixed(runFail < 0.1 ? 1 : 0)}%`}
                  </p>
                </div>
                <div>
                  <dt className="text-[12px] text-ink-muted">Failed</dt>
                  <dd className="mt-0.5 font-mono text-[18px] font-semibold tabular-nums tracking-[-0.02em] text-ink">
                    {queue.failed_open ?? 0}
                  </dd>
                  <p className="mt-0.5 text-[11.5px]">
                    <Link href="/staff/status/failed" className="font-medium text-brand hover:underline">
                      {queue.failed_open ? "Review & retry" : "Open failed queue"}
                    </Link>
                  </p>
                </div>
              </dl>

              <div className="mt-5 border-t border-line pt-5">
                <JudgeMetrics queue={queue} />
              </div>
            </section>
          ) : (
            <section className={cn(panel)}>
              <p className="text-sm text-ink-muted">Judge queue could not be loaded for this college.</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
