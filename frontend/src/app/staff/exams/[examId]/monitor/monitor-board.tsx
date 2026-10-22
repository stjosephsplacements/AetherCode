"use client";

import { Megaphone, Timer } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { EmptyState, Section, Table } from "@/components/staff/page-header";
import { ActionForm, Field, FormMessage, SubmitButton, TextArea, TextInput, initialActionState } from "@/components/staff/form";
import { Badge, Panel } from "@/components/ui/card";
import type { ExamMonitor, MonitorCandidate } from "@/lib/api-types";
import { formatCountdown, useNow } from "@/lib/client/use-now";
import { formatDateTime, formatScoreText, formatTime } from "@/lib/utils";
import { extendTime, postAnnouncement, setIntegrity, setResultsRelease } from "./actions";

const REFRESH_MS = 15_000;

type Tone = "neutral" | "success" | "warning" | "danger" | "brand";
type Status = { label: string; tone: Tone; inProgress: boolean };

/**
 * How one candidate's row reads on the monitor. `now` is null during the
 * first render (server and hydration), so the clock must not decide the
 * status before the browser has a time.
 */
export function candidateStatus(candidate: MonitorCandidate, now: number | null): Status {
  switch (candidate.lifecycle_state) {
    case null:
      return { label: "Not started", tone: "neutral", inProgress: false };
    case "active": {
      const left = now === null || !candidate.submission_deadline ? null : Date.parse(candidate.submission_deadline) - now;
      // Past the deadline the expiry worker is about to close the attempt, and
      // the server refuses extra time, so the row stops offering it.
      if (left !== null && left <= 0) return { label: "Time up", tone: "warning", inProgress: false };
      return { label: "In progress", tone: left !== null && left < 5 * 60_000 ? "warning" : "brand", inProgress: true };
    }
    case "submitted":
    case "grading":
      return { label: "Grading", tone: "neutral", inProgress: false };
    case "graded":
      return { label: "Graded", tone: "success", inProgress: false };
    case "expired":
      return { label: "Time up", tone: "neutral", inProgress: false };
    default:
      return { label: "Cancelled", tone: "danger", inProgress: false };
  }
}

export function MonitorBoard({
  examId,
  versionId,
  monitor,
  rollNumber,
}: {
  examId: string;
  versionId: string;
  monitor: ExamMonitor;
  rollNumber: Record<string, string>;
}) {
  const router = useRouter();
  const now = useNow(1000);
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);

  const rows = monitor.candidates
    .map((candidate) => ({ candidate, roll: rollNumber[candidate.candidate_id] ?? candidate.candidate_id.slice(0, 8), status: candidateStatus(candidate, now) }))
    .sort((a, b) => a.roll.localeCompare(b.roll));
  const counts = {
    assigned: rows.length,
    inProgress: rows.filter((row) => row.status.inProgress).length,
    finished: rows.filter((row) => row.candidate.submitted_at).length,
    notStarted: rows.filter((row) => !row.candidate.attempt_id).length,
  };
  const hidden = (
    <>
      <input type="hidden" name="exam_id" value={examId} />
      <input type="hidden" name="exam_version_id" value={versionId} />
    </>
  );

  return (
    <>
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Assigned", counts.assigned],
          ["In progress", counts.inProgress],
          ["Handed in", counts.finished],
          ["Not started", counts.notStarted],
        ].map(([label, value]) => (
          <Panel key={label} className="px-4 py-3.5">
            <p className="text-xs text-ink-muted">{label}</p>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">{value}</p>
          </Panel>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Timer className="size-4 text-brand" strokeWidth={1.75} />
            Extra time for everyone
          </h2>
          <ActionForm action={extendTime} submitLabel="Add time">
            {hidden}
            <Field label="Minutes" htmlFor="extend-all" hint="Added to every attempt still in progress, for example after a lab outage.">
              <TextInput id="extend-all" name="minutes" type="number" min={1} max={240} defaultValue={10} required />
            </Field>
          </ActionForm>
        </Panel>

        <Panel className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Megaphone className="size-4 text-brand" strokeWidth={1.75} />
            Announcement
          </h2>
          <ActionForm action={postAnnouncement} submitLabel="Send to everyone">
            {hidden}
            <Field label="Message" htmlFor="announcement" hint="Shown on every student's exam screen.">
              <TextArea id="announcement" name="body" maxLength={2000} required className="min-h-20" />
            </Field>
          </ActionForm>
        </Panel>

        <ReleasePanel hidden={hidden} releasedAt={monitor.results_released_at} />
      </div>

      <Panel className="mt-4 p-5">
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Integrity</h2>
        <p className="mb-4 text-sm text-ink-muted">
          Leaving the exam window is always recorded as a flag. Outside Safe Exam Browser you can also require fullscreen and block pasting text from outside the exam.
        </p>
        <ActionForm action={setIntegrity} submitLabel="Save integrity settings">
          {hidden}
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="require_fullscreen" defaultChecked={monitor.require_fullscreen} className="accent-[var(--brand)]" />
            Require fullscreen
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="block_external_paste" defaultChecked={monitor.block_external_paste} className="accent-[var(--brand)]" />
            Block pasting from outside the exam
          </label>
        </ActionForm>
      </Panel>

      {monitor.announcements.length > 0 && (
        <Section title="Sent announcements">
          <ul className="space-y-2">
            {monitor.announcements.map((note) => (
              <li key={note.id} className="rounded-[var(--radius-control)] border border-line bg-surface px-4 py-2.5 text-sm">
                <span className="mr-2 text-ink-muted">{formatTime(note.created_at)}</span>
                <span className="whitespace-pre-wrap text-ink">{note.body}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Students">
        {rows.length === 0 ? (
          <EmptyState>Nobody is assigned to this exam yet.</EmptyState>
        ) : (
          <Table head={["Roll number", "Status", "Time left", "Answered", "Flags", "Score", ""]}>
            {rows.map(({ candidate, roll, status }) => (
              <tr key={candidate.candidate_id}>
                <td className="px-4 py-2.5 font-mono text-[13px] text-ink">
                  {candidate.attempt_id ? (
                    <Link href={`/staff/exams/${examId}/attempts/${candidate.attempt_id}`} className="text-brand hover:underline">
                      {roll}
                    </Link>
                  ) : (
                    roll
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={status.tone}>{status.label}</Badge>
                </td>
                <td className="px-4 py-2.5 font-mono tabular-nums text-ink-muted">
                  {status.inProgress && candidate.submission_deadline && now !== null
                    ? formatCountdown(Date.parse(candidate.submission_deadline) - now)
                    : candidate.submitted_at
                      ? formatDateTime(candidate.submitted_at)
                      : "-"}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-ink">{candidate.attempt_id ? candidate.items_answered : "-"}</td>
                <td className="px-4 py-2.5">
                  {candidate.flags > 0 ? (
                    <Badge tone={candidate.flags >= 5 ? "danger" : "warning"} title="Left the window, left fullscreen or pasted from outside">
                      {candidate.flags}
                    </Badge>
                  ) : (
                    <span className="text-ink-subtle">-</span>
                  )}
                </td>
                <td className="px-4 py-2.5 font-mono tabular-nums text-ink">
                  {candidate.score === null ? "-" : formatScoreText(Number(candidate.score))}
                  {candidate.maximum_score !== null && <span className="text-ink-muted"> / {formatScoreText(Number(candidate.maximum_score))}</span>}
                </td>
                <td className="px-4 py-2.5">
                  {status.inProgress && candidate.attempt_id && <ExtendOne hidden={hidden} attemptId={candidate.attempt_id} roll={roll} />}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </>
  );
}

function ExtendOne({ hidden, attemptId, roll }: { hidden: React.ReactNode; attemptId: string; roll: string }) {
  const [state, action] = useActionState(extendTime, initialActionState);
  return (
    <form action={action} className="flex items-center justify-end gap-2">
      {hidden}
      <input type="hidden" name="attempt_id" value={attemptId} />
      <FormMessage state={state} />
      <TextInput aria-label={`Minutes for ${roll}`} name="minutes" type="number" min={1} max={240} defaultValue={5} required className="h-8 w-16" />
      <SubmitButton variant="secondary" className="h-8">
        Add
      </SubmitButton>
    </form>
  );
}

function ReleasePanel({ hidden, releasedAt }: { hidden: React.ReactNode; releasedAt: string | null }) {
  const [state, action] = useActionState(setResultsRelease, initialActionState);
  return (
    <Panel className="p-5">
      <h2 className="mb-1 text-[15px] font-semibold text-ink">Results</h2>
      <p className="mb-4 text-sm text-ink-muted">
        {releasedAt ? `Released ${formatDateTime(releasedAt)}. Students see their score per question.` : "Hidden. Students see only that they handed in."}
      </p>
      <form
        action={action}
        onSubmit={(event) => {
          if (!releasedAt && !confirm("Release results? Every student who handed in sees their score.")) event.preventDefault();
        }}
        className="space-y-3"
      >
        {hidden}
        <input type="hidden" name="released" value={releasedAt ? "false" : "true"} />
        <FormMessage state={state} />
        <SubmitButton variant={releasedAt ? "secondary" : "primary"}>{releasedAt ? "Hide results" : "Release results"}</SubmitButton>
      </form>
    </Panel>
  );
}
