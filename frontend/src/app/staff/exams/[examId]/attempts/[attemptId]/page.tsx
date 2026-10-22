import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LoadError, PageHeader, Section } from "@/components/staff/page-header";
import { Badge, Panel } from "@/components/ui/card";
import type { AttemptReview } from "@/lib/api-types";
import { gateway } from "@/lib/server/gateway";
import { requireCollege } from "@/lib/server/staff";
import { listAllStudents } from "@/lib/server/students";
import { formatDateTime, formatScoreText, formatTime, languageName } from "@/lib/utils";

export const metadata: Metadata = { title: "Attempt" };

/** The attempt's event log in staff words. Saves are not logged; submits and hand-in are. */
function describe(event: AttemptReview["events"][number]): string {
  const payload = event.payload;
  switch (event.event_type) {
    case "submission.attempt.started.v1":
      return "Started the exam";
    case "submission.attempt.deadline_extended.v1":
      return `Given ${Math.round(Number(payload.seconds) / 60)} minutes of extra time`;
    case "submission.attempt.submitted.v1":
      return payload.reason === "time_up" ? "Time ran out; the saved code was handed in" : "Ended the test";
    case "submission.attempt.grading.v1":
      return "Grading started";
    case "submission.attempt.graded.v1":
      return "Graded";
    case "submission.attempt.cancelled.v1":
      return "Attempt cancelled";
    case "submission.attempt.integrity.v1":
      return { blur: "Left the exam window", paste: "Tried to paste from outside the exam (blocked)", fullscreen_exit: "Left fullscreen" }[String(payload.kind)] ?? "Integrity event";
    default:
      return event.event_type.replace(/^submission\./, "").replace(/\.v\d+$/, "").replaceAll(/[._]/g, " ");
  }
}

export default async function AttemptPage({ params }: { params: Promise<{ examId: string; attemptId: string }> }) {
  const staff = await requireCollege();
  const { examId, attemptId } = await params;
  let data;
  try {
    const [review, students] = await Promise.all([
      gateway<AttemptReview>(`/submission/v1/tenants/${staff.tenantId}/attempts/${attemptId}/review`),
      listAllStudents(staff.tenantId),
    ]);
    data = { review, roll: students.find((student) => student.principal_id === review.attempt.candidate_id)?.enrollment_number };
  } catch (error) {
    return (
      <>
        <PageHeader title="Attempt" />
        <LoadError error={error} />
      </>
    );
  }
  const { review, roll } = data;
  const { attempt } = review;

  return (
    <>
      <Link href={`/staff/exams/${examId}/monitor`} className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        Live monitor
      </Link>
      <PageHeader
        title={roll ?? attempt.candidate_id.slice(0, 8)}
        description={`${attempt.title ?? "Exam"}. Started ${attempt.started_at ? formatDateTime(attempt.started_at) : "-"}, deadline ${formatDateTime(attempt.submission_deadline)}${attempt.submitted_at ? `, handed in ${formatDateTime(attempt.submitted_at)}` : ""}.`}
        actions={
          <>
            <Badge tone={attempt.lifecycle_state === "graded" ? "success" : attempt.lifecycle_state === "active" ? "brand" : "neutral"}>{attempt.lifecycle_state}</Badge>
            {review.score && (
              <Badge tone="neutral">
                {formatScoreText(Number(review.score.score))} / {formatScoreText(Number(review.score.maximum_score))}
              </Badge>
            )}
          </>
        }
      />

      {review.items.map((item, index) => (
        <Section
          key={item.exam_item_id}
          title={`${item.position ?? index + 1}. ${item.title ?? "Question"}`}
          description={`Best ${item.best_score === null ? "-" : formatScoreText(Number(item.best_score))} of ${formatScoreText(Number(item.maximum_score))} marks`}
        >
          {item.latest_answer ? (
            <Panel className="overflow-hidden">
              <p className="border-b border-line px-4 py-2 text-[13px] text-ink-muted">
                {languageName(item.latest_answer.language)}, save {item.latest_answer.revision_number}, {formatDateTime(item.latest_answer.saved_at)}
              </p>
              <pre className="max-h-[480px] overflow-auto px-4 py-3 font-mono text-[13px] leading-relaxed text-ink">{item.latest_answer.source}</pre>
            </Panel>
          ) : (
            <p className="text-sm text-ink-muted">No code saved.</p>
          )}
          {item.evaluations.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-[13px]">
              {item.evaluations.map((evaluation) => (
                <li key={`${evaluation.queued_at}-${evaluation.revision_number}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-muted">
                  <span className="font-mono tabular-nums">{formatTime(evaluation.queued_at)}</span>
                  <span className="text-ink">{evaluation.origin === "item_submit" ? "Submit" : "Hand-in"}</span>
                  <span>save {evaluation.revision_number}</span>
                  <span>
                    {Object.entries(evaluation.verdict_counts)
                      .map(([verdict, count]) => `${count} ${verdict.replaceAll("_", " ")}`)
                      .join(", ") || evaluation.lifecycle_state}
                  </span>
                  {evaluation.score !== null && <span className="font-mono text-ink">{formatScoreText(Number(evaluation.score))} marks</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ))}

      <Section title="Activity">
        <ol className="space-y-1.5 text-sm">
          {review.events.map((event, index) => (
            <li key={index} className="flex gap-3">
              <span className="w-40 shrink-0 font-mono text-[13px] tabular-nums text-ink-muted">{formatDateTime(event.occurred_at)}</span>
              <span className="text-ink">{describe(event)}</span>
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}
