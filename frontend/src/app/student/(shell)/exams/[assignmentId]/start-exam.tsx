"use client";

import { ArrowRight, CircleNotch, RocketLaunch, ShieldCheck } from "@phosphor-icons/react/ssr";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { HonorCode } from "@/components/exam/honor-code";
import { Button } from "@/components/ui/button";
import type { Attempt, CandidateAssignment, Page } from "@/lib/api-types";
import { APIError, api } from "@/lib/client/api";
import { formatCountdown, useNow } from "@/lib/client/use-now";
import { uuid } from "@/lib/client/uuid";
import { sebLaunchURL } from "@/lib/seb-launch";

type Status = { kind: "idle" } | { kind: "starting" } | { kind: "seb" } | { kind: "error"; message: string };

export function StartExam({ assignment, signature }: { assignment: CandidateAssignment; signature: string }) {
  const router = useRouter();
  const now = useNow();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [honorOpen, setHonorOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  // One key per page visit: a double click or a retry starts one attempt, not two.
  const idempotencyKey = useRef(uuid());
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

  // The ticket is single-use and lasts a minute, so it is minted on click, never on render.
  async function launchSEB() {
    setLaunching(true);
    setLaunchError(null);
    try {
      const { ticket } = await api<{ ticket: string }>(`/seb/v1/tenants/${assignment.tenant_id}/exams/${assignment.exam_id}/launch-ticket`, {
        method: "POST",
      });
      window.location.href = sebLaunchURL(window.location.origin, assignment.tenant_id, assignment.exam_id, ticket);
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : "Safe Exam Browser could not be launched.");
    } finally {
      setLaunching(false);
    }
  }

  if (status.kind === "seb") {
    return (
      <div className="mt-8 rounded-surface border border-line bg-surface p-5 shadow-[var(--shadow-panel)] sm:p-6">
        <div className="flex gap-3.5">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand" />
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Open this exam in Safe Exam Browser</h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              This exam only runs inside Safe Exam Browser. Launch it from here: Safe Exam Browser opens, starts the exam and asks you to
              sign in again. It must already be installed on this computer.
            </p>
            <Button className="mt-4" onClick={() => void launchSEB()} disabled={launching}>
              {launching ? <CircleNotch className="animate-spin" /> : <RocketLaunch />}
              Launch Safe Exam Browser
            </Button>
            {launchError && (
              <p role="alert" className="mt-2 text-sm text-danger">
                {launchError}
              </p>
            )}
            <p className="mt-3 text-sm text-ink-muted">
              Having trouble?{" "}
              <a
                className="underline underline-offset-2"
                href={`/api/seb/v1/tenants/${assignment.tenant_id}/exams/${assignment.exam_id}/launch-file`}
                download
              >
                Download config file directly
              </a>
            </p>
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
        <Button size="lg" onClick={() => setHonorOpen(true)} disabled={now === null || closed || opensIn > 0 || status.kind === "starting"}>
          {status.kind === "starting" ? <CircleNotch className="animate-spin" /> : <>Start exam<ArrowRight /></>}
        </Button>
      )}
      <HonorCode
        open={honorOpen}
        onOpenChange={setHonorOpen}
        signature={signature}
        onAgree={() => {
          setHonorOpen(false);
          void start();
        }}
      />
    </div>
  );
}
