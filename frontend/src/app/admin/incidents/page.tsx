import { CheckCircle, Warning, WarningCircle } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { panel } from "@/app/admin/_dashboard/panel";
import { CollegeLink } from "@/components/college-link";
import { EmptyState, LoadError, PageHeader } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import { LiveRefresh } from "@/lib/client/realtime";
import { loadIncidents } from "@/lib/server/incidents";
import { requireAdmin } from "@/lib/server/staff";
import { cn, formatDateTime } from "@/lib/utils";
import { ExamControls } from "./controls";

export const metadata: Metadata = { title: "Incidents" };

const age = (iso: string | null) => (iso ? `${Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))} s` : "—");

export default async function IncidentsPage() {
  const staff = await requireAdmin();
  let board;
  try {
    board = await loadIncidents(staff);
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="Incidents" />
        <LoadError error={error} />
      </div>
    );
  }

  const critical = board.incidents.filter((incident) => incident.severity === "critical").length;
  const soft = board.incidents.length - critical;
  const services = board.health?.services ?? [];
  const ready = services.filter((service) => service.ready).length;
  const writing = board.liveExams.reduce((sum, exam) => sum + exam.inProgress, 0);
  const handedIn = board.liveExams.reduce((sum, exam) => sum + exam.handedIn, 0);
  const waiting = board.liveExams.reduce((sum, exam) => sum + exam.notStarted, 0);
  const flags = board.liveExams.reduce((sum, exam) => sum + exam.flags, 0);
  const queued = board.queues.reduce((sum, { queue }) => sum + (queue ? queue.evaluations.queued + queue.runs.queued : 0), 0);
  const dispatched = board.queues.reduce((sum, { queue }) => sum + (queue ? queue.evaluations.dispatched + queue.runs.dispatched : 0), 0);
  const failedHour = board.queues.reduce((sum, { queue }) => sum + (queue?.evaluations.failed_last_hour ?? 0), 0);
  const gradedHour = board.queues.reduce((sum, { queue }) => sum + (queue?.evaluations.completed_last_hour ?? 0), 0);
  const assigned = writing + handedIn + waiting;
  const open = board.incidents.length;

  return (
    <div className="animate-enter space-y-6">
      <LiveRefresh topics={["grading", "attempts"]} fallbackSeconds={15} />
      <PageHeader
        title="Incidents"
        description={
          open === 0
            ? `All clear · ${ready}/${services.length || 0} services ready · ${writing} writing · ${queued} queued. Updates while this page is open.`
            : `${open} open${critical ? ` · ${critical} critical` : ""}${soft ? ` · ${soft} warning` : ""} · ${writing} writing · ${queued} queued. Updates while this page is open.`
        }
        actions={
          open === 0 ? (
            <Badge tone="success">All clear</Badge>
          ) : (
            <Badge tone={critical ? "danger" : "warning"}>
              {open} open{critical ? `, ${critical} critical` : ""}
            </Badge>
          )
        }
      />

      {/* Focal: calm or incident list */}
      <section aria-label="Incident board" className={cn(panel)}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{open === 0 ? "All clear" : "Attention needed"}</h2>
          <p className="font-mono text-[12px] tabular-nums text-ink-muted">
            {ready}/{services.length || 0} services ready
          </p>
        </div>

        {open === 0 ? (
          <div className="mt-4 flex items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-control bg-success/15 text-success">
              <CheckCircle className="size-4" weight="fill" />
            </span>
            <p className="text-[13.5px] leading-relaxed text-ink-muted">
              {ready}/{services.length || 0} services ready
              {queued ? ` · ${queued} in judge queue` : " · judge queue idle"}
              {board.liveExams.length ? ` · ${board.liveExams.length} live exam${board.liveExams.length === 1 ? "" : "s"}` : ""}
              {failedHour ? ` · ${failedHour} grading failure${failedHour === 1 ? "" : "s"} in the last hour` : ""}
            </p>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-control border border-line">
            {board.incidents.map((incident, index) => {
              const Icon = incident.severity === "critical" ? WarningCircle : Warning;
              const body = (
                <>
                  <span
                    className={cn(
                      "mt-0.5 grid size-8 shrink-0 place-items-center rounded-control",
                      incident.severity === "critical" ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning",
                    )}
                  >
                    <Icon className="size-4" weight="fill" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-ink">
                      <span className={cn("font-mono text-[10.5px] uppercase tracking-[0.08em]", incident.severity === "critical" ? "text-danger" : "text-warning")}>
                        {incident.severity}
                      </span>
                      {incident.title}
                    </p>
                    <p className="mt-1 text-[12.5px] leading-snug text-ink-muted">{incident.detail}</p>
                  </div>
                </>
              );
              const cls = "flex items-start gap-3 px-3.5 py-3 transition-colors hover:bg-hover";
              return (
                <li key={`${incident.title}-${index}`}>
                  {incident.href ? (
                    <Link href={incident.href} className={cls}>
                      {body}
                    </Link>
                  ) : (
                    <div className={cls}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Secondary strip — not equal tiles */}
        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 sm:grid-cols-4">
          <div>
            <dt className="text-[12px] text-ink-muted">Writing now</dt>
            <dd className="mt-0.5 font-mono text-[18px] font-semibold tabular-nums tracking-[-0.02em] text-ink">{writing}</dd>
            <p className="mt-0.5 text-[11.5px] text-ink-subtle">
              {board.liveExams.length ? `${board.liveExams.length} open exam${board.liveExams.length === 1 ? "" : "s"}` : "no exam open"}
            </p>
          </div>
          <div>
            <dt className="text-[12px] text-ink-muted">Judge queue</dt>
            <dd className="mt-0.5 font-mono text-[18px] font-semibold tabular-nums tracking-[-0.02em] text-ink">{queued}</dd>
            <p className="mt-0.5 text-[11.5px] text-ink-subtle">{dispatched ? `${dispatched} with the judge` : "nothing dispatched"}</p>
          </div>
          <div>
            <dt className="text-[12px] text-ink-muted">Graded (1 h)</dt>
            <dd className="mt-0.5 font-mono text-[18px] font-semibold tabular-nums tracking-[-0.02em] text-ink">{gradedHour}</dd>
            <p className="mt-0.5 text-[11.5px] text-ink-subtle">{failedHour ? `${failedHour} failed` : "no failures"}</p>
          </div>
          <div>
            <dt className="text-[12px] text-ink-muted">Live cohort</dt>
            <dd className="mt-0.5 font-mono text-[18px] font-semibold tabular-nums tracking-[-0.02em] text-ink">{assigned}</dd>
            <p className="mt-0.5 text-[11.5px] text-ink-subtle">
              {handedIn} in · {waiting} waiting · {flags} flags
            </p>
          </div>
        </dl>

        {assigned > 0 && (
          <div className="mt-4">
            <div className="flex h-2 overflow-hidden rounded-pill bg-hover" role="img" aria-label={`${writing} writing, ${handedIn} handed in, ${waiting} waiting`}>
              {writing > 0 && <span className="bg-brand" style={{ flex: writing }} />}
              {handedIn > 0 && <span className="bg-ink" style={{ flex: handedIn }} />}
              {waiting > 0 && <span className="bg-line-strong" style={{ flex: waiting }} />}
            </div>
            <p className="mt-2 flex flex-wrap gap-4 text-[11.5px] text-ink-subtle">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-pill bg-brand" /> writing
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-pill bg-ink" /> handed in
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-pill bg-line-strong" /> waiting
              </span>
            </p>
          </div>
        )}
      </section>

      {/* Live exams — table, not card grid */}
      <section aria-label="Exams in progress">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Exams in progress</h2>
            <p className="mt-0.5 text-[13px] text-ink-muted">Add time or announce to everyone still writing.</p>
          </div>
          <p className="font-mono text-[12px] tabular-nums text-ink-subtle">{board.liveExams.length} open</p>
        </div>
        {board.liveExams.length === 0 ? (
          <div className={cn(panel)}>
            <EmptyState>No exam is open right now.</EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-surface border border-line bg-surface shadow-[var(--shadow-panel)]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-sidebar">
                  {["Exam", "College", "Writing", "In", "Wait", "Flags", "Closes", "Controls"].map((label) => (
                    <th key={label} scope="col" className="px-4 py-2.5 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-ink-subtle">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="[&_tr+tr]:border-t [&_tr+tr]:border-line">
                {board.liveExams.map((exam) => (
                  <tr key={exam.versionId} className="align-top transition-colors hover:bg-hover">
                    <td className="px-4 py-3 font-medium text-ink">
                      <CollegeLink
                        href={`/admin/open?college=${exam.collegeId}&next=${encodeURIComponent(`/staff/exams/${exam.examId}/monitor`)}`}
                        className="hover:text-brand"
                      >
                        {exam.title}
                      </CollegeLink>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{exam.collegeName}</td>
                    <td className="px-4 py-3 font-mono tabular-nums text-ink">{exam.inProgress}</td>
                    <td className="px-4 py-3 font-mono tabular-nums text-ink">{exam.handedIn}</td>
                    <td className="px-4 py-3 font-mono tabular-nums text-ink">{exam.notStarted}</td>
                    <td className="px-4 py-3 font-mono tabular-nums text-ink">{exam.flags}</td>
                    <td className="px-4 py-3 text-ink-muted">{formatDateTime(exam.closesAt)}</td>
                    <td className="px-4 py-3">
                      <ExamControls tenantId={exam.collegeId} versionId={exam.versionId} title={exam.title} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Judge queues — dense table */}
      <section aria-label="Judge queue">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Judge queue</h2>
            <p className="mt-0.5 text-[13px] text-ink-muted">Code waiting to be graded or run, per college.</p>
          </div>
          <Link href="/admin/status" className="text-[13px] font-medium text-brand hover:underline">
            System status
          </Link>
        </div>
        {board.queues.length === 0 ? (
          <div className={cn(panel)}>
            <EmptyState>No colleges to show queues for.</EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-surface border border-line bg-surface shadow-[var(--shadow-panel)]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-sidebar">
                  {["College", "State", "Grade queued", "With judge", "Oldest wait", "Failed (1 h)", "Runs queued", "Oldest run"].map((label) => (
                    <th key={label} scope="col" className="px-4 py-2.5 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-ink-subtle">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="[&_tr+tr]:border-t [&_tr+tr]:border-line">
                {board.queues.map(({ collegeId, collegeName, queue }) => {
                  const load = queue ? queue.evaluations.queued + queue.runs.queued + queue.evaluations.dispatched + queue.runs.dispatched : 0;
                  const state = !queue ? "down" : load > 0 ? "busy" : "idle";
                  return (
                    <tr key={collegeId} className="transition-colors hover:bg-hover">
                      <td className="px-4 py-3 font-medium text-ink">{collegeName}</td>
                      <td className={cn("px-4 py-3 font-mono text-[11px] uppercase tracking-[0.08em]", state === "busy" ? "text-warning" : state === "down" ? "text-danger" : "text-success")}>
                        {state}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-ink">{queue ? queue.evaluations.queued : "—"}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-ink">{queue ? queue.evaluations.dispatched : "—"}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-ink">{queue ? age(queue.evaluations.oldest_waiting_at) : "—"}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-ink">{queue ? queue.evaluations.failed_last_hour : "—"}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-ink">{queue ? queue.runs.queued : "—"}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-ink">{queue ? age(queue.runs.oldest_waiting_at) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
