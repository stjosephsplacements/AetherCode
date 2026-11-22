import type { Metadata } from "next";
import { CheckCircle } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import {
  BarChart,
  ColumnChart,
  DonutChart,
  FloorChart,
  FigureCard,
  ServiceStrip,
  SparkBars,
} from "@/app/admin/_dashboard/charts";
import { panel } from "@/app/admin/_dashboard/panel";
import { CollegeLink } from "@/components/college-link";
import { ServicesBadge } from "@/components/staff/live-services";
import { PageHeader } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import { LiveRefresh } from "@/lib/client/realtime";
import { collegeHref } from "@/lib/links";
import { loadIncidents } from "@/lib/server/incidents";
import { requireAdmin } from "@/lib/server/staff";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

/** Dense ops board: figures and charts that Overview keeps secondary. */
export default async function AdminDashboardPage() {
  const staff = await requireAdmin();
  const board = await loadIncidents(staff).catch(() => null);
  const health = board?.health ?? null;
  const services = health?.services ?? [];
  const ready = services.filter((service) => service.ready).length;
  const down = services.length - ready;
  const critical = board?.incidents.filter((incident) => incident.severity === "critical").length ?? 0;
  const soft = (board?.incidents.length ?? 0) - critical;
  const warnings = board?.incidents.length ?? 0;
  const live = board?.liveExams ?? [];
  const writing = live.reduce((sum, exam) => sum + exam.inProgress, 0);
  const handedIn = live.reduce((sum, exam) => sum + exam.handedIn, 0);
  const waiting = live.reduce((sum, exam) => sum + exam.notStarted, 0);
  const flags = live.reduce((sum, exam) => sum + exam.flags, 0);
  const queues = board?.queues ?? [];
  const queueBars = queues.map(({ collegeName, queue }) => ({
    label: collegeName,
    value: queue ? queue.evaluations.queued + queue.evaluations.dispatched + queue.runs.queued + queue.runs.dispatched : 0,
    tone: (queue && queue.evaluations.queued + queue.runs.queued > 0 ? "warning" : "brand") as "warning" | "brand",
  }));
  const gradedHour = queues.reduce((sum, { queue }) => sum + (queue?.evaluations.completed_last_hour ?? 0), 0);
  const failedHour = queues.reduce((sum, { queue }) => sum + (queue?.evaluations.failed_last_hour ?? 0), 0);
  const runsHour = queues.reduce((sum, { queue }) => sum + (queue?.runs.completed_last_hour ?? 0), 0);
  const activeColleges = staff.tenants.filter((tenant) => tenant.status === "active").length;
  const latencyColumns = services.map((service) => ({
    label: service.name,
    value: service.milliseconds,
    tone: (service.milliseconds > 40 ? "warning" : service.ready ? "brand" : "danger") as "warning" | "brand" | "danger",
  }));
  const failBars = queues.map(({ collegeName, queue }) => ({
    label: collegeName,
    value: queue?.evaluations.failed_last_hour ?? 0,
    tone: "danger" as const,
  }));
  const throughputSpark = queues.flatMap(({ collegeName, queue }) => [
    { label: `${collegeName} graded`, value: queue?.evaluations.completed_last_hour ?? 0 },
    { label: `${collegeName} runs`, value: queue?.runs.completed_last_hour ?? 0 },
  ]);
  const medianMs = queues
    .map(({ queue }) => queue?.evaluations.median_seconds_last_hour)
    .filter((value): value is number => typeof value === "number");
  const slowestMedian = medianMs.length ? Math.max(...medianMs) : null;
  const collegeStatus = staff.tenants.map((tenant) => {
    const queue = queues.find((entry) => entry.collegeId === tenant.id)?.queue;
    const load = queue ? queue.evaluations.queued + queue.runs.queued : 0;
    return { id: tenant.id, name: tenant.display_name, status: tenant.status, load, slug: tenant.slug };
  });
  const queuedNow = queueBars.reduce((sum, bar) => sum + bar.value, 0);

  return (
    <div className="animate-enter">
      <LiveRefresh topics={["grading", "attempts", "activity"]} fallbackSeconds={20} />
      <PageHeader
        title="Dashboard"
        description="Dense ops view — queues, health, and live cohort in one place. Overview stays the calm scan."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ServicesBadge initial={health} />
            {warnings > 0 ? (
              <Badge tone={critical ? "danger" : "warning"}>
                {warnings} incident{warnings === 1 ? "" : "s"}
                {critical ? `, ${critical} critical` : ""}
              </Badge>
            ) : (
              <Badge tone="success">All clear</Badge>
            )}
          </div>
        }
      />

      <div className="grid auto-rows-[minmax(132px,auto)] gap-3 md:grid-cols-6 xl:grid-cols-12">
        <FigureCard label="Colleges" value={String(staff.tenants.length)} note={`${activeColleges} active`} className="md:col-span-3 xl:col-span-3" />
        <FigureCard
          label="Incidents"
          value={String(warnings)}
          note={critical ? `${critical} critical · ${soft} warning` : warnings ? "open now" : "nothing open"}
          tone={critical ? "bad" : warnings ? "warn" : "good"}
          className="md:col-span-3 xl:col-span-3"
        />
        <FigureCard
          label="Writing now"
          value={String(writing)}
          note={live.length ? `in ${live.length} live exam${live.length === 1 ? "" : "s"}` : "no exam open"}
          className="md:col-span-3 xl:col-span-3"
        />
        <FigureCard
          label="Graded (1 h)"
          value={String(gradedHour)}
          note={failedHour ? `${failedHour} failed · ${runsHour} runs` : `${runsHour} sample runs`}
          tone={failedHour > 0 ? "warn" : "good"}
          className="md:col-span-3 xl:col-span-3"
        />

        <DonutChart
          title="Service health"
          note="Ready versus not ready across the gateway probe."
          centre={`${services.length ? Math.round((ready / services.length) * 100) : 0}%`}
          centreNote="ready"
          slices={[
            { label: "Ready", value: ready, tone: "success" },
            { label: "Down", value: down, tone: "danger" },
          ]}
          empty="No service health yet."
          className="md:col-span-3 xl:col-span-4 xl:row-span-2"
        />
        <DonutChart
          title="Live cohort"
          note="Everyone assigned to an open exam right now."
          centre={String(writing + handedIn + waiting)}
          centreNote="assigned"
          slices={[
            { label: "Writing", value: writing, tone: "brand" },
            { label: "Handed in", value: handedIn, tone: "success" },
            { label: "Not started", value: waiting, tone: "muted" },
          ]}
          empty="No exam is open."
          className="md:col-span-3 xl:col-span-4 xl:row-span-2"
        />
        <DonutChart
          title="Incident mix"
          note="Severity of problems on the board."
          centre={String(warnings)}
          centreNote="open"
          slices={[
            { label: "Critical", value: critical, tone: "danger" },
            { label: "Warning", value: soft, tone: "warning" },
            { label: "Clear", value: warnings === 0 ? 1 : 0, tone: "success" },
          ]}
          empty="All clear."
          className="md:col-span-6 xl:col-span-4 xl:row-span-2"
        />

        <ColumnChart
          title="Gateway latency"
          note="Probe round-trip per service, milliseconds."
          columns={latencyColumns}
          unit="ms"
          empty="No latency samples yet."
          className="md:col-span-6 xl:col-span-5"
        />
        <BarChart title="Judge load" note="Queued and in-flight grading plus sample runs." bars={queueBars} empty="No college queues yet." className="md:col-span-6 xl:col-span-7" />

        <FloorChart
          title="Live exam floors"
          note="Who is writing, handed in, or still waiting."
          rows={live.slice(0, 6).map((exam) => ({
            id: exam.versionId,
            label: `${exam.title} · ${exam.collegeName}`,
            writing: exam.inProgress,
            handedIn: exam.handedIn,
            waiting: exam.notStarted,
          }))}
          empty="No exam is open right now."
          className="md:col-span-6 xl:col-span-7"
        />
        <section aria-label="Open incidents" className={cn(panel, "h-full md:col-span-6 xl:col-span-5")}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Open incidents</h2>
            <Link href="/admin/incidents" className="text-[13px] font-medium text-brand hover:underline">
              Full board
            </Link>
          </div>
          {!board || board.incidents.length === 0 ? (
            <div className="mt-4 flex flex-1 flex-col justify-between gap-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-control bg-success/15 text-success">
                  <CheckCircle className="size-4" weight="fill" />
                </span>
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-ink">All clear</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
                    {ready}/{services.length || 0} services ready
                    {queuedNow ? ` · ${queuedNow} in judge queue` : " · judge queue idle"}
                    {live.length ? ` · ${live.length} live exam${live.length === 1 ? "" : "s"}` : ""}
                  </p>
                </div>
              </div>
              <dl className="grid grid-cols-3 gap-2 border-t border-line pt-3">
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-subtle">Graded</dt>
                  <dd className="mt-1 font-mono text-[15px] tabular-nums text-ink">{gradedHour}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-subtle">Failed</dt>
                  <dd className="mt-1 font-mono text-[15px] tabular-nums text-ink">{failedHour}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-subtle">Flags</dt>
                  <dd className="mt-1 font-mono text-[15px] tabular-nums text-ink">{flags}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <ul className="mt-4 flex-1 divide-y divide-line border-t border-line">
              {board.incidents.slice(0, 6).map((incident, index) => (
                <li key={`${incident.title}-${index}`} className="py-3">
                  <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium text-ink">
                    <span className={cn("font-mono text-[10.5px] uppercase tracking-[0.08em]", incident.severity === "critical" ? "text-danger" : "text-warning")}>
                      {incident.severity}
                    </span>
                    {incident.title}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-ink-muted">{incident.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <BarChart title="Grading failures (1 h)" note="Failed evaluations returned by the judge, per college." bars={failBars} empty="No failures in the last hour." className="md:col-span-6 xl:col-span-6" />
        <SparkBars title="Throughput mix" note="Graded submissions and sample runs completed in the last hour." values={throughputSpark} empty="No throughput yet." className="md:col-span-6 xl:col-span-6" />

        <ServiceStrip
          title="Service readiness detail"
          ready={ready}
          total={services.length}
          rows={services.map((service) => ({ name: service.name, ready: service.ready, ms: service.milliseconds }))}
          className="md:col-span-6 xl:col-span-5"
        />
        <section aria-label="Judge pace" className={cn(panel, "h-full md:col-span-6 xl:col-span-3")}>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Judge pace</h2>
          <div className="mt-4 flex flex-1 flex-col justify-between gap-4">
            <div>
              <p className="font-mono text-[2rem] font-semibold tabular-nums leading-none text-ink">
                {slowestMedian === null ? "—" : `${slowestMedian.toFixed(1)}s`}
              </p>
              <p className="mt-2 text-[12.5px] leading-snug text-ink-muted">Slowest college median grade time, last hour.</p>
            </div>
            <dl className="grid grid-cols-2 gap-2 border-t border-line pt-3">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-subtle">Flags</dt>
                <dd className="mt-1 font-mono text-[15px] tabular-nums text-ink">{flags}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-subtle">Queued</dt>
                <dd className="mt-1 font-mono text-[15px] tabular-nums text-ink">{queuedNow}</dd>
              </div>
            </dl>
          </div>
        </section>
        <section aria-label="College status" className={cn(panel, "h-full md:col-span-6 xl:col-span-4")}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Colleges</h2>
            <Link href="/admin/colleges" className="text-[13px] font-medium text-brand hover:underline">
              Manage
            </Link>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            {activeColleges} active · {staff.tenants.length} total · {queuedNow} queued
          </p>
          {collegeStatus.length === 0 ? (
            <p className="mt-4 flex-1 text-sm text-ink-muted">No colleges yet.</p>
          ) : (
            <ul className="mt-3 flex-1 space-y-1">
              {collegeStatus.slice(0, 6).map((college) => (
                <li key={college.id}>
                  <CollegeLink href={collegeHref("/staff", college.id)} className="flex items-center justify-between gap-3 rounded-control px-2 py-2 transition-colors hover:bg-hover">
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium text-ink">{college.name}</span>
                      <span className="block truncate font-mono text-[11px] text-ink-subtle">
                        {college.slug} · {college.status}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[12px] tabular-nums text-ink-muted">{college.load} queued</span>
                  </CollegeLink>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {live.length > 0 && (
        <section className={cn(panel, "mt-3")}>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Exams in progress</h2>
              <p className="mt-1 text-[12.5px] text-ink-muted">Open windows across every college.</p>
            </div>
            <Link href="/admin/incidents" className="text-[13px] font-medium text-brand hover:underline">
              Controls
            </Link>
          </div>
          <div className="overflow-x-auto rounded-control border border-line">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-hover/40">
                  {["Exam", "College", "Writing", "Handed in", "Waiting", "Flags", "Closes"].map((label) => (
                    <th key={label} scope="col" className="px-4 py-2.5 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-ink-subtle">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="[&_tr+tr]:border-t [&_tr+tr]:border-line">
                {live.slice(0, 8).map((exam) => (
                  <tr key={exam.versionId} className="transition-colors hover:bg-hover/60">
                    <td className="px-4 py-3 font-medium text-ink">
                      <CollegeLink href={`/admin/open?college=${exam.collegeId}&next=${encodeURIComponent(`/staff/exams/${exam.examId}/monitor`)}`} className="hover:text-brand">
                        {exam.title}
                      </CollegeLink>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{exam.collegeName}</td>
                    <td className="px-4 py-3 font-mono tabular-nums text-ink">{exam.inProgress}</td>
                    <td className="px-4 py-3 font-mono tabular-nums text-ink">{exam.handedIn}</td>
                    <td className="px-4 py-3 font-mono tabular-nums text-ink">{exam.notStarted}</td>
                    <td className="px-4 py-3 font-mono tabular-nums text-ink">{exam.flags}</td>
                    <td className="px-4 py-3 text-ink-muted">{formatDateTime(exam.closesAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
