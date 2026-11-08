import { CheckCircle, WarningCircle, Warning } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, LoadError, PageHeader, Section, Table } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import { LiveRefresh } from "@/lib/client/realtime";
import { loadIncidents } from "@/lib/server/incidents";
import { requireAdmin } from "@/lib/server/staff";
import { formatDateTime } from "@/lib/utils";
import { ExamControls } from "./controls";

export const metadata: Metadata = { title: "Incidents" };

const age = (iso: string | null) => (iso ? `${Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))} s` : "none");

export default async function IncidentsPage() {
  const staff = await requireAdmin();
  let board;
  try {
    board = await loadIncidents(staff);
  } catch (error) {
    return (
      <>
        <PageHeader title="Incidents" />
        <LoadError error={error} />
      </>
    );
  }
  const critical = board.incidents.filter((incident) => incident.severity === "critical").length;
  return (
    <>
      <LiveRefresh topics={["grading", "attempts"]} fallbackSeconds={15} />
      <PageHeader
        title="Incidents"
        description="What needs attention across every college, right now. Updates in real time."
        actions={
          board.incidents.length === 0 ? (
            <Badge tone="success">All clear</Badge>
          ) : (
            <Badge tone={critical ? "danger" : "warning"}>
              {board.incidents.length} open{critical ? `, ${critical} critical` : ""}
            </Badge>
          )
        }
      />

      {board.incidents.length === 0 ? (
        <div className="mb-8 flex items-center gap-3 rounded-[var(--radius-surface)] border border-line bg-surface p-5">
          <CheckCircle className="size-5 text-success" />
          <p className="text-sm text-ink-muted">Services are ready, the judge queue is moving and nothing is restarting.</p>
        </div>
      ) : (
        <ul className="mb-8 space-y-2">
          {board.incidents.map((incident, index) => {
            const Icon = incident.severity === "critical" ? WarningCircle : Warning;
            const body = (
              <>
                <Icon className={incident.severity === "critical" ? "mt-0.5 size-5 shrink-0 text-danger" : "mt-0.5 size-5 shrink-0 text-warning"} />
                <div>
                  <p className="text-[14.5px] font-medium text-ink">{incident.title}</p>
                  <p className="mt-0.5 text-[13px] text-ink-muted">{incident.detail}</p>
                </div>
              </>
            );
            const cls = "flex items-start gap-3 rounded-[var(--radius-surface)] border border-line bg-surface p-4";
            return (
              <li key={index}>
                {incident.href ? (
                  <Link href={incident.href} className={`${cls} transition-shadow hover:shadow-[var(--shadow-panel)]`}>
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

      <Section title="Exams in progress" description="Open now, in any college. Add time or send a message to everyone in one exam.">
        {board.liveExams.length === 0 ? (
          <EmptyState>No exam is open right now.</EmptyState>
        ) : (
          <Table head={["Exam", "College", "In progress", "Handed in", "Not started", "Flags", "Closes", ""]}>
            {board.liveExams.map((exam) => (
              <tr key={exam.versionId} className="align-middle">
                <td className="px-4 py-3 font-medium text-ink">
                  <Link href={`/admin/open?college=${exam.collegeId}&next=${encodeURIComponent(`/staff/exams/${exam.examId}/monitor`)}`} className="hover:text-brand">
                    {exam.title}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink-muted">{exam.collegeName}</td>
                <td className="px-4 py-3 font-mono tabular-nums">{exam.inProgress}</td>
                <td className="px-4 py-3 font-mono tabular-nums">{exam.handedIn}</td>
                <td className="px-4 py-3 font-mono tabular-nums">{exam.notStarted}</td>
                <td className="px-4 py-3 font-mono tabular-nums">{exam.flags}</td>
                <td className="px-4 py-3 text-ink-muted">{formatDateTime(exam.closesAt)}</td>
                <td className="px-4 py-3">
                  <ExamControls tenantId={exam.collegeId} versionId={exam.versionId} title={exam.title} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Judge queue" description="Code waiting to be graded or run, per college.">
        <Table head={["College", "Grading queued", "With the judge", "Oldest waiting", "Failed (1 h)", "Runs queued", "Oldest run"]}>
          {board.queues.map(({ collegeId, collegeName, queue }) => (
            <tr key={collegeId}>
              <td className="px-4 py-3 font-medium text-ink">{collegeName}</td>
              {queue ? (
                <>
                  <td className="px-4 py-3 font-mono tabular-nums">{queue.evaluations.queued}</td>
                  <td className="px-4 py-3 font-mono tabular-nums">{queue.evaluations.dispatched}</td>
                  <td className="px-4 py-3 font-mono tabular-nums">{age(queue.evaluations.oldest_waiting_at)}</td>
                  <td className="px-4 py-3 font-mono tabular-nums">{queue.evaluations.failed_last_hour}</td>
                  <td className="px-4 py-3 font-mono tabular-nums">{queue.runs.queued}</td>
                  <td className="px-4 py-3 font-mono tabular-nums">{age(queue.runs.oldest_waiting_at)}</td>
                </>
              ) : (
                <td colSpan={6} className="px-4 py-3 text-ink-muted">
                  Unavailable
                </td>
              )}
            </tr>
          ))}
        </Table>
      </Section>
    </>
  );
}
