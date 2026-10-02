"use client";

import { useState, useTransition } from "react";
import { saveExam } from "../actions";
import { LANGUAGES, LANGUAGE_IDS, type LanguageId } from "@/lib/languages";
import { Button, Card, Field, inputClass, cx } from "@/components/ui";

export interface ExamFormValues {
  title: string;
  instructions: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  languages: LanguageId[];
  batches: string[];
  published: boolean;
  allowedNetworks: string[];
  requireFullscreen: boolean;
  blockExternalPaste: boolean;
  questions: Array<{ questionId: string; points: number }>;
}

// datetime-local works in the browser's zone; convert to/from ISO at the edges.
const toLocalInput = (iso: string) => {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : "");

export function ExamForm({
  id,
  initial,
  questionBank,
  knownBatches,
  locked,
  viewerIp,
}: {
  id: string | null;
  initial: ExamFormValues;
  questionBank: Array<{ id: string; title: string }>;
  knownBatches: string[];
  locked: boolean;
  viewerIp: string | null;
}) {
  const [networksText, setNetworksText] = useState(initial.allowedNetworks.join("\n"));
  const [values, setValues] = useState(initial);
  const [newBatch, setNewBatch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof ExamFormValues>(key: K, value: ExamFormValues[K]) => setValues((current) => ({ ...current, [key]: value }));
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item]);
  const batchOptions = [...new Set([...knownBatches, ...values.batches])].sort();
  const titleOf = new Map(questionBank.map((question) => [question.id, question.title]));
  const available = questionBank.filter((question) => !values.questions.some((entry) => entry.questionId === question.id));

  function submit() {
    setError(null);
    startTransition(async () => {
      const allowedNetworks = networksText
        .split(/[\s,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean);
      const result = await saveExam(id, { ...values, allowedNetworks });
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="grid gap-6">
      <Card className="grid gap-5 p-6">
        <Field label="Exam title">
          <input value={values.title} onChange={(event) => set("title", event.target.value)} className={inputClass} placeholder="CS201 Lab Test 1" />
        </Field>
        <Field label="Instructions" hint="Shown before the student starts.">
          <textarea value={values.instructions} onChange={(event) => set("instructions", event.target.value)} rows={4} className={inputClass} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Window opens">
            <input type="datetime-local" value={toLocalInput(values.startsAt)} onChange={(event) => set("startsAt", fromLocalInput(event.target.value))} className={inputClass} />
          </Field>
          <Field label="Window closes" hint="No one can start or submit after this.">
            <input type="datetime-local" value={toLocalInput(values.endsAt)} onChange={(event) => set("endsAt", fromLocalInput(event.target.value))} className={inputClass} />
          </Field>
          <Field label="Duration (minutes)" hint="Each student's clock starts when they begin.">
            <input type="number" min={1} max={1440} value={values.durationMinutes} onChange={(event) => set("durationMinutes", Number(event.target.value))} className={inputClass} />
          </Field>
        </div>
        <div>
          <span className="mb-2 block text-[13px] font-semibold">Languages</span>
          <div className="flex flex-wrap gap-2">
            {LANGUAGE_IDS.map((language) => (
              <button
                key={language}
                type="button"
                onClick={() => set("languages", toggle(values.languages, language))}
                className={cx(
                  "rounded-full border px-3.5 py-1.5 text-sm font-medium",
                  values.languages.includes(language) ? "border-brand bg-brand-soft text-brand-ink" : "border-line-strong text-muted",
                )}
              >
                {LANGUAGES[language].label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="mb-2 block text-[13px] font-semibold">Batches who can take it</span>
          <div className="flex flex-wrap items-center gap-2">
            {batchOptions.map((batch) => (
              <button
                key={batch}
                type="button"
                onClick={() => set("batches", toggle(values.batches, batch))}
                className={cx(
                  "rounded-full border px-3.5 py-1.5 text-sm font-medium",
                  values.batches.includes(batch) ? "border-brand bg-brand-soft text-brand-ink" : "border-line-strong text-muted",
                )}
              >
                {batch}
              </button>
            ))}
            <input
              value={newBatch}
              onChange={(event) => setNewBatch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && newBatch.trim()) {
                  event.preventDefault();
                  set("batches", [...new Set([...values.batches, newBatch.trim()])]);
                  setNewBatch("");
                }
              }}
              placeholder="Other batch + Enter"
              className="w-44 rounded-full border border-dashed border-line-strong bg-transparent px-3.5 py-1.5 text-sm"
            />
          </div>
        </div>
      </Card>

      <Card className="grid gap-5 p-6">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">Lab lockdown</h2>
          <p className="mt-1 text-sm text-muted">Safe Exam Browser is not used, so these keep the exam in the lab and in the editor.</p>
        </div>
        <Field
          label="Allowed networks"
          hint={`One IPv4 address or range per line, e.g. 10.20.0.0/16. Leave empty to allow any network. Your IP as seen by the server: ${viewerIp ?? "unknown"}`}
        >
          <textarea value={networksText} onChange={(event) => setNetworksText(event.target.value)} rows={3} placeholder="10.20.0.0/16" className={`${inputClass} font-mono text-[13px]`} />
        </Field>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={values.requireFullscreen} onChange={(event) => set("requireFullscreen", event.target.checked)} className="mt-0.5 size-4 accent-brand" />
          <span>
            <strong>Require fullscreen.</strong> The exam is hidden until the student enters fullscreen; every exit is logged.
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={values.blockExternalPaste} onChange={(event) => set("blockExternalPaste", event.target.checked)} className="mt-0.5 size-4 accent-brand" />
          <span>
            <strong>Block pasting from outside the editor.</strong> Copy-paste within their own code still works; outside pastes are blocked and logged.
          </span>
        </label>
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold tracking-tight">Questions</h2>
          {!locked && available.length > 0 && (
            <select
              value=""
              onChange={(event) => event.target.value && set("questions", [...values.questions, { questionId: event.target.value, points: 100 }])}
              className={`${inputClass} max-w-xs`}
            >
              <option value="">+ Add from question bank</option>
              {available.map((question) => (
                <option key={question.id} value={question.id}>
                  {question.title}
                </option>
              ))}
            </select>
          )}
        </div>
        {locked && <p className="mb-4 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent">Students have started this exam, so its questions are locked. Timing, batches and publishing can still change.</p>}
        <ol className="divide-y divide-line rounded-xl border border-line">
          {values.questions.map((entry, index) => (
            <li key={entry.questionId} className="flex items-center gap-3 px-4 py-3">
              <span className="w-6 font-display font-semibold text-faint">{index + 1}</span>
              <span className="mr-auto font-medium">{titleOf.get(entry.questionId) ?? "Unknown question"}</span>
              <label className="flex items-center gap-2 text-sm text-muted">
                Points
                <input
                  type="number"
                  min={1}
                  max={1000}
                  disabled={locked}
                  value={entry.points}
                  onChange={(event) =>
                    set("questions", values.questions.map((item, at) => (at === index ? { ...item, points: Number(event.target.value) } : item)))
                  }
                  className="w-20 rounded-lg border border-line-strong px-2 py-1 text-ink"
                />
              </label>
              {!locked && (
                <button type="button" onClick={() => set("questions", values.questions.filter((_, at) => at !== index))} className="text-sm text-muted hover:text-error">
                  Remove
                </button>
              )}
            </li>
          ))}
          {values.questions.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">No questions added yet.</li>}
        </ol>
      </Card>

      <div className="sticky bottom-0 -mx-5 flex flex-wrap items-center justify-end gap-4 border-t border-line bg-canvas/90 px-5 py-4 backdrop-blur">
        {error && <p className="mr-auto text-sm font-medium text-error">{error}</p>}
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={values.published} onChange={(event) => set("published", event.target.checked)} className="size-4 accent-brand" />
          Published (visible to students)
        </label>
        <Button type="button" onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Save exam"}
        </Button>
      </div>
    </div>
  );
}
