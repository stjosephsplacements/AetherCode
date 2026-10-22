"use client";

import { Check, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Attempt, AttemptResult } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { formatDateTime, formatScoreText } from "@/lib/utils";

// Confirms the submission and follows grading. Marks stay hidden until
// faculty release results (ADR-0027), then show per question.
export function AttemptStatus({ tenantId, attemptId }: { tenantId: string; attemptId: string }) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const latest = await api<Attempt>(`/submission/v1/tenants/${tenantId}/attempts/${attemptId}`);
        if (stopped) return;
        setAttempt(latest);
        if (latest.lifecycle_state === "active" || latest.lifecycle_state === "submitted" || latest.lifecycle_state === "grading") {
          setTimeout(poll, 3000);
        } else if (latest.lifecycle_state === "graded") {
          setResult(await api<AttemptResult>(`/submission/v1/tenants/${tenantId}/attempts/${attemptId}/result`));
        }
      } catch (caught) {
        if (!stopped) setError(caught instanceof Error ? caught.message : "Could not load your attempt.");
      }
    }
    void poll();
    return () => {
      stopped = true;
    };
  }, [tenantId, attemptId]);

  const pending = !attempt || attempt.lifecycle_state === "active";
  const graded = attempt?.lifecycle_state === "graded";
  if (result?.released) return <ReleasedResult result={result} />;

  return (
    <div className="mx-auto max-w-md animate-enter pt-6 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-success-soft text-success">
        {pending ? <LoaderCircle className="size-5 animate-spin" /> : <Check className="size-5" strokeWidth={2.25} />}
      </div>
      <h1 className="display mt-6 text-[2.2rem] text-ink">{pending ? "Handing in your work" : "Exam submitted"}</h1>
      {error ? (
        <p className="mt-3 text-sm text-danger">{error}</p>
      ) : (
        <p className="mx-auto mt-3 max-w-[36ch] text-[15px] leading-relaxed text-ink-muted">
          {pending
            ? "Submitting the code you saved last."
            : graded
              ? "Your answers have been graded. Your faculty will publish the results."
              : "Your answers are being graded. You can close this page."}
        </p>
      )}
      {attempt?.submitted_at && <p className="mt-2 text-[13px] text-ink-subtle">Received {formatDateTime(attempt.submitted_at)}</p>}
      <Button asChild variant="secondary" className="mt-9">
        <Link href="/student">Back to my exams</Link>
      </Button>
    </div>
  );
}

function ReleasedResult({ result }: { result: Extract<AttemptResult, { released: true }> }) {
  return (
    <div className="mx-auto max-w-lg animate-enter pt-6">
      <p className="text-center text-sm text-ink-muted">Your score</p>
      <p className="display mt-2 text-center text-[3rem] tabular-nums text-ink">
        {formatScoreText(Number(result.score))}
        <span className="text-[1.75rem] text-ink-muted"> / {formatScoreText(Number(result.maximum_score))}</span>
      </p>
      <ul className="mt-9 overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
        {result.items.map((item, index) => (
          <li key={item.exam_item_id} className={index > 0 ? "border-t border-line px-5 py-3" : "px-5 py-3"}>
            <div className="flex items-center gap-4">
              <span className="w-6 shrink-0 text-sm text-ink-muted">{item.position ?? index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[15px] text-ink">{item.title ?? "Question"}</span>
              <span className="shrink-0 font-mono text-sm tabular-nums text-ink">
                {formatScoreText(Number(item.score))} / {formatScoreText(Number(item.maximum_score))}
              </span>
            </div>
            {item.tests && item.tests.length > 0 && (
              <ol className="mt-2 flex flex-wrap gap-1.5 pl-10" aria-label="Tests">
                {item.tests.map((test) => (
                  <li
                    key={test.number}
                    title={test.verdict.replaceAll("_", " ")}
                    className={
                      test.verdict === "accepted"
                        ? "rounded-md bg-success-soft px-2 py-0.5 font-mono text-[11px] text-success"
                        : "rounded-md bg-danger-soft px-2 py-0.5 font-mono text-[11px] text-danger"
                    }
                  >
                    Test {test.number} {test.verdict === "accepted" ? "passed" : test.verdict.replaceAll("_", " ")}
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-center text-[13px] text-ink-subtle">Each question counts your best submission. Released {formatDateTime(result.released_at)}.</p>
      <div className="mt-9 text-center">
        <Button asChild variant="secondary">
          <Link href="/student">Back to my exams</Link>
        </Button>
      </div>
    </div>
  );
}
