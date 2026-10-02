"use client";

import { useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { saveQuestion, type QuestionInput } from "../actions";
import { Button, Card, Field, inputClass, cx } from "@/components/ui";

interface Test {
  input: string;
  expectedOutput: string;
  isSample: boolean;
  weight: number;
}

const STARTER = `Given an integer **n**, print the sum of the first n natural numbers.

### Input format
A single integer n.

### Output format
Print one integer.

### Constraints
- 1 ≤ n ≤ 10^6
`;

export function QuestionForm({ id, initial }: { id: string | null; initial?: QuestionInput & { tests: Test[] } }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [statement, setStatement] = useState(initial?.statement ?? STARTER);
  const [timeLimitMs, setTimeLimitMs] = useState(Number(initial?.timeLimitMs ?? 2000));
  const [memoryLimitMb, setMemoryLimitMb] = useState(Number(initial?.memoryLimitMb ?? 256));
  const [tests, setTests] = useState<Test[]>(
    initial?.tests ?? [
      { input: "", expectedOutput: "", isSample: true, weight: 1 },
      { input: "", expectedOutput: "", isSample: false, weight: 1 },
    ],
  );
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const update = (index: number, patch: Partial<Test>) =>
    setTests((current) => current.map((test, at) => (at === index ? { ...test, ...patch } : test)));

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await saveQuestion(id, { title, statement, timeLimitMs, memoryLimitMb, tests });
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="grid gap-6">
      <Card className="grid gap-5 p-6">
        <Field label="Title">
          <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} placeholder="Sum of N numbers" />
        </Field>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[13px] font-semibold">Problem statement (Markdown)</span>
            <div className="flex rounded-full bg-sunken p-0.5 text-xs font-semibold">
              {(["Write", "Preview"] as const).map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setPreview(label === "Preview")}
                  className={cx("rounded-full px-3 py-1", preview === (label === "Preview") ? "bg-surface text-ink shadow-sm" : "text-muted")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {preview ? (
            <div className="prose-exam min-h-72 rounded-xl border border-line bg-surface px-5 py-3">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{statement}</ReactMarkdown>
            </div>
          ) : (
            <textarea
              value={statement}
              onChange={(event) => setStatement(event.target.value)}
              rows={14}
              className={`${inputClass} font-mono text-[13px] leading-relaxed`}
            />
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Time limit (ms)" hint="Per test. Java and Python get 2× automatically.">
            <input type="number" min={100} max={20000} value={timeLimitMs} onChange={(event) => setTimeLimitMs(Number(event.target.value))} className={inputClass} />
          </Field>
          <Field label="Memory limit (MB)">
            <input type="number" min={16} max={1024} value={memoryLimitMb} onChange={(event) => setMemoryLimitMb(Number(event.target.value))} className={inputClass} />
          </Field>
        </div>
      </Card>

      <div className="flex items-end justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">Test cases</h2>
          <p className="text-sm text-muted">
            Samples are shown to students and used by <strong>Run</strong>. Every test, sample and hidden, counts toward the score by weight.
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => setTests((current) => [...current, { input: "", expectedOutput: "", isSample: false, weight: 1 }])}>
          + Add test
        </Button>
      </div>

      {tests.map((test, index) => (
        <Card key={index} className="p-5">
          <div className="mb-3 flex flex-wrap items-center gap-4">
            <span className="font-display font-semibold">Test {index + 1}</span>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={test.isSample} onChange={(event) => update(index, { isSample: event.target.checked })} className="size-4 accent-brand" />
              Sample (visible)
            </label>
            <label className="flex items-center gap-2 text-sm">
              Weight
              <input type="number" min={1} max={100} value={test.weight} onChange={(event) => update(index, { weight: Number(event.target.value) })} className="w-16 rounded-lg border border-line-strong px-2 py-1 text-sm" />
            </label>
            <button
              type="button"
              disabled={tests.length === 1}
              onClick={() => setTests((current) => current.filter((_, at) => at !== index))}
              className="ml-auto text-sm font-medium text-muted hover:text-error disabled:opacity-40"
            >
              Remove
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <textarea value={test.input} onChange={(event) => update(index, { input: event.target.value })} rows={5} placeholder="Input (stdin)" className={`${inputClass} font-mono text-[13px]`} />
            <textarea value={test.expectedOutput} onChange={(event) => update(index, { expectedOutput: event.target.value })} rows={5} placeholder="Expected output" className={`${inputClass} font-mono text-[13px]`} />
          </div>
        </Card>
      ))}

      <div className="sticky bottom-0 -mx-5 flex items-center justify-end gap-3 border-t border-line bg-canvas/90 px-5 py-4 backdrop-blur">
        {error && <p className="mr-auto text-sm font-medium text-error">{error}</p>}
        <Button type="button" onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Save question"}
        </Button>
      </div>
    </div>
  );
}
