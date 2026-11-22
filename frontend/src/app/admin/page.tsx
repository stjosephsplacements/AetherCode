import type { Metadata } from "next";
import {
  ArrowRight,
  Briefcase,
  Buildings,
  ChartBar,
  ChartDonut,
  CheckCircle,
  Pulse,
  Scroll,
  ShieldCheck,
  UserGear,
  Warning,
} from "@phosphor-icons/react/ssr";
import type { Icon } from "@phosphor-icons/react";
import Link from "next/link";
import { BarChart, ColumnChart } from "@/app/admin/_dashboard/charts";
import { panel } from "@/app/admin/_dashboard/panel";
import { CollegeLink } from "@/components/college-link";
import { ServicesBadge } from "@/components/staff/live-services";
import { PageHeader } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import { LiveRefresh } from "@/lib/client/realtime";
import { loadIncidents } from "@/lib/server/incidents";
import { requireAdmin } from "@/lib/server/staff";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin" };

const DESTINATIONS: { href: string; title: string; text: string; Icon: Icon }[] = [
  { href: "/admin/dashboard", title: "Dashboard", text: "Dense charts for queues, health, and cohort", Icon: ChartDonut },
  { href: "/admin/incidents", title: "Incidents", text: "Open problems and live exam controls", Icon: Warning },
  { href: "/admin/colleges", title: "Colleges", text: "Add and manage college workspaces", Icon: Buildings },
  { href: "/admin/admins", title: "Administrators", text: "Platform-wide access", Icon: UserGear },
  { href: "/admin/permissions", title: "Permissions", text: "Narrow what admins may do", Icon: ShieldCheck },
  { href: "/admin/analytics", title: "Analytics", text: "Prometheus load and latency", Icon: ChartBar },
  { href: "/admin/status", title: "System status", text: "Service health and judge queue", Icon: Pulse },
  { href: "/admin/audit", title: "Audit log", text: "Staff changes across colleges", Icon: Scroll },
  { href: "/admin/placement", title: "Placement", text: "Org, tracks, and officers", Icon: Briefcase },
];

export default async function AdminHome() {
  const staff = await requireAdmin();
  const board = await loadIncidents(staff).catch(() => null);
  const health = board?.health ?? null;
  const services = health?.services ?? [];
  const ready = services.filter((service) => service.ready).length;
  const critical = board?.incidents.filter((incident) => incident.severity === "critical").length ?? 0;
  const soft = (board?.incidents.length ?? 0) - critical;
  const warnings = board?.incidents.length ?? 0;
  const live = board?.liveExams ?? [];
  const writing = live.reduce((sum, exam) => sum + exam.inProgress, 0);
  const queues = board?.queues ?? [];
  const queueBars = queues.map(({ collegeName, queue }) => ({
    label: collegeName,
    value: queue ? queue.evaluations.queued + queue.evaluations.dispatched + queue.runs.queued + queue.runs.dispatched : 0,
    tone: (queue && queue.evaluations.queued + queue.runs.queued > 0 ? "warning" : "brand") as "warning" | "brand",
  }));
  const gradedHour = queues.reduce((sum, { queue }) => sum + (queue?.evaluations.completed_last_hour ?? 0), 0);
  const failedHour = queues.reduce((sum, { queue }) => sum + (queue?.evaluations.failed_last_hour ?? 0), 0);
  const activeColleges = staff.tenants.filter((tenant) => tenant.status === "active").length;
  const latencyColumns = services.map((service) => ({
    label: service.name,
    value: service.milliseconds,
    tone: (service.milliseconds > 40 ? "warning" : service.ready ? "brand" : "danger") as "warning" | "brand" | "danger",
  }));
  const queuedNow = queueBars.reduce((sum, bar) => sum + bar.value, 0);

  return (
    <div className="animate-enter space-y-6">
      <LiveRefresh topics={["grading", "attempts", "activity"]} fallbackSeconds={20} />
      <PageHeader
        title="Overview"
        description="Is the platform calm? Act from here when something needs a hand."
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

      {/* Focal: calm or incident state */}
      <section aria-label="Platform status" className={cn(panel)}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {warnings === 0 ? "All clear" : "Attention needed"}
          </h2>
          <Link href="/admin/incidents" className="text-[13px] font-medium text-brand hover:underline">
            Full board
          </Link>
        </div>

        {!board || board.incidents.length === 0 ? (
          <div className="mt-4 flex items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-control bg-success/15 text-success">
              <CheckCircle className="size-4" weight="fill" />
            </span>
            <p className="text-[13.5px] leading-relaxed text-ink-muted">
              {ready}/{services.length || 0} services ready
              {queuedNow ? ` · ${queuedNow} in judge queue` : " · judge queue idle"}
              {live.length ? ` · ${live.length} live exam${live.length === 1 ? "" : "s"}` : ""}
              {failedHour ? ` · ${failedHour} grading failure${failedHour === 1 ? "" : "s"} in the last hour` : ""}
            </p>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line border-t border-line">
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

        {/* Secondary strip — not equal tiles */}
        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 sm:grid-cols-4">
          <div>
            <dt className="text-[12px] text-ink-muted">Writing now</dt>
            <dd className="mt-0.5 font-mono text-[18px] font-semibold tabular-nums tracking-[-0.02em] text-ink">{writing}</dd>
            <p className="mt-0.5 text-[11.5px] text-ink-subtle">{live.length ? `${live.length} open exam${live.length === 1 ? "" : "s"}` : "no exam open"}</p>
          </div>
          <div>
            <dt className="text-[12px] text-ink-muted">Graded (1 h)</dt>
            <dd className="mt-0.5 font-mono text-[18px] font-semibold tabular-nums tracking-[-0.02em] text-ink">{gradedHour}</dd>
            <p className="mt-0.5 text-[11.5px] text-ink-subtle">{failedHour ? `${failedHour} failed` : "no failures"}</p>
          </div>
          <div>
            <dt className="text-[12px] text-ink-muted">Services</dt>
            <dd className="mt-0.5 font-mono text-[18px] font-semibold tabular-nums tracking-[-0.02em] text-ink">
              {ready}/{services.length || 0}
            </dd>
            <p className="mt-0.5 text-[11.5px] text-ink-subtle">ready</p>
          </div>
          <div>
            <dt className="text-[12px] text-ink-muted">Colleges</dt>
            <dd className="mt-0.5 font-mono text-[18px] font-semibold tabular-nums tracking-[-0.02em] text-ink">{staff.tenants.length}</dd>
            <p className="mt-0.5 text-[11.5px] text-ink-subtle">{activeColleges} active{critical || soft ? ` · ${warnings} open` : ""}</p>
          </div>
        </dl>
      </section>

      {/* Two charts that answer ops questions */}
      <div className="grid gap-3 lg:grid-cols-2">
        <BarChart title="Judge load" note="Queued and in-flight grading plus sample runs." bars={queueBars} empty="No college queues yet." />
        <ColumnChart
          title="Gateway latency"
          note="Probe round-trip per service, milliseconds."
          columns={latencyColumns}
          unit="ms"
          empty="No latency samples yet."
        />
      </div>

      {live.length > 0 && (
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Exams in progress</h2>
              <p className="mt-0.5 text-[13px] text-ink-muted">Open windows across every college.</p>
            </div>
            <Link href="/admin/incidents" className="text-[13px] font-medium text-brand hover:underline">
              Controls
            </Link>
          </div>
          <div className="overflow-x-auto rounded-surface border border-line bg-surface shadow-[var(--shadow-panel)]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-sidebar">
                  {["Exam", "College", "Writing", "Handed in", "Waiting", "Flags", "Closes"].map((label) => (
                    <th key={label} scope="col" className="px-4 py-2.5 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-ink-subtle">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="[&_tr+tr]:border-t [&_tr+tr]:border-line">
                {live.slice(0, 8).map((exam) => (
                  <tr key={exam.versionId} className="transition-colors hover:bg-hover">
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

      <section>
        <h2 className="mb-2 text-[15px] font-semibold tracking-[-0.01em] text-ink">Go somewhere</h2>
        <p className="mb-3 text-[13px] text-ink-muted">Same destinations as the sidebar.</p>
        <ul className="divide-y divide-line overflow-hidden rounded-surface border border-line bg-surface shadow-[var(--shadow-panel)]">
          {DESTINATIONS.map(({ href, title, text, Icon }) => (
            <li key={href}>
              <Link href={href} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-hover">
                <Icon className="size-4 shrink-0 text-ink-muted group-hover:text-ink" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">{title}</span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-ink-muted">{text}</span>
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-ink-subtle transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-hover:translate-x-0.5 group-hover:text-ink" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
