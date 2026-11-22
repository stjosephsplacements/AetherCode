"use client";

import { ArrowLeft, Check, CheckCircle, CircleNotch, UploadSimple, XCircle } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { WorkspaceTools } from "./workspace-tools";
import type { PracticeMcqQuestion, PracticeMcqRun } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { cn, formatDateTime } from "@/lib/utils";

const DIFFICULTY_TONE = { easy: "success", medium: "warning", hard: "danger" } as const;

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "done"; run: PracticeMcqRun }
  | { kind: "error"; message: string };

export function McqPracticeWorkspace({ tenantId, question }: { tenantId: string; question: PracticeMcqQuestion }) {
  const base = `/question-bank/v1/tenants/${tenantId}/practice`;
  const [selected, setSelected] = useState<number[]>([]);
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });
  const [feedback, setFeedback] = useState<PracticeMcqRun | null>(null);
  const [history, setHistory] = useState<PracticeMcqRun[] | undefined>(undefined);

  const fetchHistory = useCallback(
    () =>
      api<PracticeMcqRun[]>(`${base}/questions/${question.question_id}/submissions`).then(
        (runs) => runs.filter((entry) => entry.mode === "submit"),
        () => [],
      ),
    [base, question.question_id],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchHistory().then((runs) => {
      if (!cancelled) setHistory(runs);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchHistory]);

  const solved = history?.some((entry) => entry.verdict === "accepted") ?? false;

  function toggle(index: number) {
    if (feedback) return;
    setSelected((current) => {
      if (question.multiple_choice) {
        return current.includes(index) ? current.filter((value) => value !== index) : [...current, index].sort((a, b) => a - b);
      }
      return current.includes(index) ? [] : [index];
    });
  }

  const submitAnswer = useCallback(async () => {
    if (selected.length === 0) return void toast("Pick at least one option.");
    setSubmit({ kind: "submitting" });
    try {
      const { id } = await api<{ id: string }>(`${base}/questions/${question.question_id}/submissions`, {
        method: "POST",
        body: { mode: "submit", selected },
      });
      const run = await api<PracticeMcqRun>(`${base}/submissions/${id}`);
      setSubmit({ kind: "done", run });
      setFeedback(run);
      if (run.verdict === "accepted") toast.success("Correct.");
      else toast.message("Not quite. Read the explanations below.");
      void fetchHistory().then(setHistory);
    } catch (error) {
      setSubmit({ kind: "error", message: error instanceof Error ? error.message : "Submit failed." });
    }
  }, [base, question.question_id, selected, fetchHistory]);

  async function reviewPast(id: string) {
    const run = await api<PracticeMcqRun>(`${base}/submissions/${id}`).catch(() => null);
    if (!run?.choices) return void toast.error("That submission could not be opened.");
    setFeedback(run);
    setSelected(run.selected_choices ?? []);
  }

  const showFeedback = feedback?.choices && feedback.correct_choices;

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Link href="/student/practice" className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4" />
          Practice
        </Link>
        <Badge tone="neutral">Multiple choice</Badge>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{question.title}</h1>
        {solved && <Badge tone="success">Solved</Badge>}
        <WorkspaceTools storageKey={`practice-mcq-${question.question_id}`} />
      </header>

      <div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <article className="rounded-panel border border-line bg-surface px-5 py-6 shadow-[var(--shadow-panel)]">
          <h2 className="display text-[1.75rem] text-ink">{question.title}</h2>
          <p className="mt-3 flex flex-wrap gap-2 text-[13px] text-ink-muted">
            <Badge tone={DIFFICULTY_TONE[question.difficulty]}>{question.difficulty}</Badge>
            {question.tags.map((tag) => (
              <span key={tag} className="rounded-pill bg-hover px-2.5 py-0.5">
                {tag}
              </span>
            ))}
          </p>
          <Markdown className="mt-6">{question.prompt_markdown}</Markdown>
        </article>

        <section aria-label="Options" className="rounded-panel border border-line bg-surface shadow-[var(--shadow-panel)]">
          <p className="border-b px-4 py-3 text-[13px] font-medium text-ink">
            {question.multiple_choice ? "Choose every correct option" : "Choose one option"}
          </p>
          <ol className="space-y-2 p-4">
            {(question.choices ?? []).map((choice, position) => {
              const index = position;
              const picked = selected.includes(index);
              const correct = showFeedback ? feedback!.correct_choices!.includes(index) : undefined;
              return (
                <li key={index}>
                  <button
                    type="button"
                    disabled={Boolean(showFeedback)}
                    onClick={() => toggle(index)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-control border px-4 py-3 text-left text-sm transition-colors",
                      showFeedback && correct && "border-success bg-success-soft",
                      showFeedback && picked && !correct && "border-danger bg-danger-soft",
                      !showFeedback && picked && "border-brand bg-brand-soft",
                      !showFeedback && !picked && "border-line hover:border-line-strong hover:bg-hover",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid size-5 shrink-0 place-items-center border text-[11px] font-semibold",
                        question.multiple_choice ? "rounded-chip" : "rounded-pill",
                        picked ? "border-brand bg-brand text-brand-ink" : "border-line-strong text-ink-muted",
                      )}
                    >
                      {picked ? <Check className="size-3" /> : String.fromCharCode(65 + position)}
                    </span>
                    <Markdown className="min-w-0 flex-1 [&>*:first-child]:mt-0">{choice}</Markdown>
                  </button>
                  {showFeedback && feedback!.choice_explanations?.[index] && (
                    <p className="mt-1.5 px-2 text-[13px] leading-relaxed text-ink-muted">{feedback!.choice_explanations![index]}</p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        {submit.kind === "error" && <p className="text-[13px] text-danger">{submit.message}</p>}
        {submit.kind === "done" && (
          <p className={cn("text-[15px] font-medium", submit.run.verdict === "accepted" ? "text-success" : "text-danger")}>
            {submit.run.verdict === "accepted" ? "Correct" : "Incorrect"}
          </p>
        )}

        {!showFeedback && (
          <div className="flex justify-end gap-2 pb-4">
            <Button onClick={submitAnswer} disabled={submit.kind === "submitting" || selected.length === 0}>
              {submit.kind === "submitting" ? <CircleNotch className="animate-spin" /> : <UploadSimple />}
              Submit
            </Button>
          </div>
        )}

        {showFeedback && (
          <Button variant="secondary" className="self-end" onClick={() => { setFeedback(null); setSelected([]); setSubmit({ kind: "idle" }); }}>
            Try again
          </Button>
        )}

        {history && history.length > 0 && (
          <section className="pb-6">
            <h3 className="mb-2 text-[13px] font-medium text-ink-muted">Past submissions</h3>
            <ul className="divide-y divide-line rounded-control border border-line bg-surface">
              {history.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
                  {entry.verdict === "accepted" ? <CheckCircle className="size-4 text-success" /> : <XCircle className="size-4 text-danger" />}
                  <span className="font-medium">{entry.verdict === "accepted" ? "Correct" : "Incorrect"}</span>
                  <span className="text-ink-subtle">{formatDateTime(entry.requested_at)}</span>
                  <button type="button" onClick={() => reviewPast(entry.id)} className="ml-auto text-brand hover:underline">
                    Review
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}