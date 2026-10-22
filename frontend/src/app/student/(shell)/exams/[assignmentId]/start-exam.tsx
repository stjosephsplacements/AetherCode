"use client";

import { ArrowRight, Download, LoaderCircle, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Attempt, CandidateAssignment, Page } from "@/lib/api-types";
import { APIError, api } from "@/lib/client/api";
import { formatCountdown, useNow } from "@/lib/client/use-now";

type Status = { kind: "idle" } | { kind: "starting" } | { kind: "seb" } | { kind: "error"; message: string };

export function StartExam({ assignment }: { assignment: CandidateAssignment }) {
  const router = useRouter();
  const now = useNow();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [resumeId, setResumeId] = useState<string | null>(null);
  // One key per page visit: a double click or a retry starts one attempt, not two.
  const idempotencyKey = useRef(crypto.randomUUID());
  const attempts = `/submission/v1/tenants/${assignment.tenant_id}/attempts`;
  const opensIn = now === null ? 0 : Date.parse(assignment.available_from) - now;
  const closed = now !== null && now >= Date.parse(assignment.available_until);

  useEffect(() => {
    if (assignment.lifecycle_state !== "started") return;
    api<Page<Attempt>>(`${attempts}?exam_version_id=${assignment.exam_version_id}`)
      .then((page) => {
        const open = page.items.find(
          (attempt) =>
            attempt.candidate_assignment_id === assignment.id &&
            (attempt.lifecycle_state === "active" || attempt.lifecycle_state === "created"),
        );
        if (open) setResumeId(open.id);
      })
      .catch((error: unknown) => {
        if (error instanceof APIError && error.code === "seb_required") setStatus({ kind: "seb" });
      });
  }, [assignment, attempts]);

  async function start() {
    setStatus({ kind: "starting" });
    try {
      const attempt = await api<Attempt>(attempts, {
        method: "POST",
        body: { candidate_assignment_id: assignment.id },
        idempotencyKey: idempotencyKey.current,
      });
      router.push(`/student/attempts/${attempt.id}`);
    } catch (error) {
      if (error instanceof APIError && error.code === "seb_required") return setStatus({ kind: "seb" });
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "The exam could not be started." });
    }
  }

  if (status.kind === "seb") {
    return (
      <div className="mt-8 rounded-[var(--radius-surface)] border border-line bg-surface p-5 shadow-[var(--shadow-panel)] sm:p-6">
        <div className="flex gap-3.5">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand" strokeWidth={1.75} />
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Open this exam in Safe Exam Browser</h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              This exam only runs inside Safe Exam Browser. Download the launch file and open it. Safe Exam Browser starts the exam and
              asks you to sign in again.
            </p>
            <Button asChild variant="secondary" className="mt-4">
              <a href={`/api/seb/v1/tenants/${assignment.tenant_id}/exams/${assignment.exam_id}/launch-file`} download>
                <Download />
                Download launch file
              </a>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const note = closed
    ? "This exam's window has closed."
    : opensIn > 0
      ? `Opens in ${formatCountdown(opensIn)}`
      : resumeId
        ? "You've started this exam. Your saved code is waiting."
        : "Ready when you are.";

  return (
    <div className="mt-8 flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
      <div aria-live="polite">
        <p className="text-sm text-ink-muted tabular-nums">{now === null ? " " : note}</p>
        {status.kind === "error" && (
          <p role="alert" className="mt-1 text-sm text-danger">
            {status.message}
          </p>
        )}
      </div>
      {resumeId ? (
        <Button size="lg" onClick={() => router.push(`/student/attempts/${resumeId}`)}>
          Resume exam
          <ArrowRight />
        </Button>
      ) : (
        <Button size="lg" onClick={start} disabled={now === null || closed || opensIn > 0 || status.kind === "starting"}>
          {status.kind === "starting" ? <LoaderCircle className="animate-spin" /> : <>Start exam<ArrowRight /></>}
        </Button>
      )}
    </div>
  );
}
