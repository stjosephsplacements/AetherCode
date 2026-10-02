"use client";

import { useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { checkSolution, saveQuestion, type QuestionInput, type SolutionCheck } from "../actions";
import { LANGUAGES, LANGUAGE_IDS } from "@/lib/languages";
import { normalizeOutput } from "@/lib/compare";
import { VERDICT_LABEL } from "@/lib/verdicts";
import { pairTestFiles, readZip } from "@/lib/test-files";
import { Button, Card, Field, buttonClass, inputClass, cx } from "@/components/ui";

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

export function QuestionForm({
  id,
  initial,
}: {
  id: string | null;
  initial?: Omit<QuestionInput, "tests"> & { tests: Test[]; referenceLanguage: string | null; referenceSource: string | null };
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [statement, setStatement] = useState(initial?.statement ?? STARTER);
  const [timeLimitMs, setTimeLimitMs] = useState(Number(initial?.timeLimitMs ?? 2000));
  const [memoryLimitMb, setMemoryLimitMb] = useState(Number(initial?.memoryLimitMb ?? 256));
  const [referenceLanguage, setReferenceLanguage] = useState(initial?.referenceLanguage ?? "cpp");
  const [referenceSource, setReferenceSource] = useState(initial?.referenceSource ?? "");
  const [check, setCheck] = useState<SolutionCheck | null>(null);
  const [checking, startChecking] = useTransition();
  const [tests, setTests] = useState<Test[]>(
    initial?.tests ?? [
      { input: "", expectedOutput: "", isSample: true, weight: 1 },
      { input: "", expectedOutput: "", isSample: false, weight: 1 },
    ],
  );
  const [preview, setPreview] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const update = (index: number, patch: Partial<Test>) =>
    setTests((current) => current.map((test, at) => (at === index ? { ...test, ...patch } : test)));

  async function importFiles(fileList: FileList) {
    setImportNote(null);
    try {
      const files: Array<{ path: string; content: string }> = [];
      for (const file of Array.from(fileList)) {
        if (file.name.toLowerCase().endsWith(".zip")) files.push(...(await readZip(await file.arrayBuffer())));
        else files.push({ path: file.webkitRelativePath || file.name, content: await file.text() });
      }
      const { tests: paired, unmatched } = pairTestFiles(files);
      if (paired.length === 0) {
        setImportNote("No input/output pairs found. Name files like input00.txt + output00.txt, or 1.in + 1.out.");
        return;
      }
      setTests((current) => {
        // Drop the untouched starter rows so imports don't sit behind empty tests.
        const kept = current.filter((test) => test.input.trim() !== "" || test.expectedOutput.trim() !== "");
        const hasSample = kept.some((test) => test.isSample);
        return [
          ...kept,
          ...paired.map((test, index) => ({ input: test.input, expectedOutput: test.expectedOutput, isSample: !hasSample && index === 0, weight: 1 })),
        ];
      });
      setImportNote(
        `Imported ${paired.length} test${paired.length === 1 ? "" : "s"}.` + (unmatched.length ? ` Skipped: ${unmatched.slice(0, 5).join(", ")}${unmatched.length > 5 ? "…" : ""}` : ""),
      );
    } catch (failure) {
      setImportNote(failure instanceof Error ? failure.message : "Could not read those files.");
    }
  }

  function runCheck() {
    setCheck(null);
    startChecking(async () =>
      setCheck(await checkSolution({ language: referenceLanguage, source: referenceSource, timeLimitMs, memoryLimitMb, tests })),
    );
  }

  // Replace expected outputs with the solution's output for tests it ran successfully.
  function adoptOutputs(indexes: number[]) {
    if (!check?.tests) return;
    setTests((current) => current.map((test, index) => (indexes.includes(index) ? { ...test, expectedOutput: check.tests![index].actual } : test)));
    setCheck((current) =>
      current?.tests ? { ...current, tests: current.tests.map((entry, index) => (indexes.includes(index) ? { ...entry, verdict: "accepted" } : entry)) } : current,
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await saveQuestion(id, {
        title,
        statement,
        timeLimitMs,
        memoryLimitMb,
        tests,
        referenceLanguage: referenceSource.trim() ? referenceLanguage : null,
        referenceSource: referenceSource.trim() ? referenceSource : null,
      });
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
        <div className="flex gap-2">
          <label className={`${buttonClass("secondary", "sm")} cursor-pointer`}>
            Import files / .zip
            <input
              type="file"
              multiple
              accept=".zip,.txt,.in,.out,.ans"
              className="sr-only"
              onChange={(event) => {
                if (event.target.files?.length) void importFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
          <Button type="button" variant="secondary" size="sm" onClick={() => setTests((current) => [...current, { input: "", expectedOutput: "", isSample: false, weight: 1 }])}>
            + Add test
          </Button>
        </div>
      </div>
      {importNote && <p className="-mt-3 rounded-xl bg-brand-soft px-4 py-2.5 text-sm text-brand-ink">{importNote}</p>}

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
            <TestText value={test.input} onChange={(value) => update(index, { input: value })} placeholder="Input (stdin)" />
            <TestText value={test.expectedOutput} onChange={(value) => update(index, { expectedOutput: value })} placeholder="Expected output" />
          </div>
        </Card>
      ))}

      <Card className="grid gap-4 p-6">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">Model solution</h2>
          <p className="mt-1 text-sm text-muted">
            Faculty only, never shown to students. Run it against the tests above to catch wrong expected outputs before the exam, or to fill outputs in
            automatically from inputs.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select value={referenceLanguage} onChange={(event) => setReferenceLanguage(event.target.value)} className={`${inputClass} w-auto`}>
            {LANGUAGE_IDS.map((language) => (
              <option key={language} value={language}>
                {LANGUAGES[language].label}
              </option>
            ))}
          </select>
          <Button type="button" variant="secondary" onClick={runCheck} disabled={checking || !referenceSource.trim()}>
            {checking ? "Running on the judge…" : "Check tests with this solution"}
          </Button>
        </div>
        <textarea
          value={referenceSource}
          onChange={(event) => setReferenceSource(event.target.value)}
          rows={10}
          spellCheck={false}
          placeholder="Paste a correct solution"
          className={`${inputClass} font-mono text-[13px]`}
        />
        {check?.error && <p className="rounded-xl bg-error-soft px-4 py-3 text-sm text-error">{check.error}</p>}
        {check?.compileOutput !== undefined && (
          <pre className="max-h-48 overflow-auto rounded-xl bg-error-soft px-4 py-3 font-mono text-xs text-error">{check.compileOutput || "Compilation failed."}</pre>
        )}
        {check?.tests && <CheckResults check={check.tests} tests={tests} limitMs={timeLimitMs * LANGUAGES[referenceLanguage as keyof typeof LANGUAGES].timeMultiplier} onAdopt={adoptOutputs} />}
      </Card>

      <div className="sticky bottom-0 -mx-5 flex items-center justify-end gap-3 border-t border-line bg-canvas/90 px-5 py-4 backdrop-blur">
        {error && <p className="mr-auto text-sm font-medium text-error">{error}</p>}
        <Button type="button" onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Save question"}
        </Button>
      </div>
    </div>
  );
}

const LARGE_TEXT = 20_000;

// Huge imported tests would make a textarea sluggish; show a summary instead.
function TestText({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  if (value.length > LARGE_TEXT) {
    const lines = value.split("\n").length;
    return (
      <div className={`${inputClass} font-mono text-[13px]`}>
        <p className="mb-1 font-sans text-xs font-semibold text-muted">
          Large file: {(value.length / 1024).toFixed(0)} KB, {lines.toLocaleString()} lines
        </p>
        <pre className="max-h-24 overflow-hidden whitespace-pre-wrap text-faint">{value.slice(0, 300)}…</pre>
      </div>
    );
  }
  return <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={5} placeholder={placeholder} className={`${inputClass} font-mono text-[13px]`} />;
}

function CheckResults({
  check,
  tests,
  limitMs,
  onAdopt,
}: {
  check: NonNullable<SolutionCheck["tests"]>;
  tests: Test[];
  limitMs: number;
  onAdopt: (indexes: number[]) => void;
}) {
  const ran = (verdict: string) => verdict === "accepted" || verdict === "wrong_answer";
  const mismatched = check.flatMap((entry, index) => (entry.verdict === "wrong_answer" ? [index] : []));
  const passed = check.filter((entry) => entry.verdict === "accepted").length;
  const slowest = Math.max(0, ...check.map((entry) => entry.timeMs ?? 0));
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <strong className={passed === check.length ? "text-pass" : "text-fail"}>
          {passed}/{check.length} tests match the solution
        </strong>
        {slowest > limitMs * 0.5 && (
          <span className="text-accent">
            Slowest test took {slowest} ms of the {limitMs} ms limit. Slower but correct student solutions may time out.
          </span>
        )}
        {mismatched.length > 0 && (
          <Button type="button" variant="secondary" size="sm" className="ml-auto" onClick={() => onAdopt(mismatched)}>
            Use solution output for {mismatched.length} test{mismatched.length === 1 ? "" : "s"}
          </Button>
        )}
      </div>
      <ul className="grid gap-2">
        {check.map((entry, index) => (
          <li key={index} className="rounded-xl border border-line px-4 py-2.5 text-sm">
            <div className="flex items-center gap-3">
              <span className="font-semibold">Test {index + 1}</span>
              <span className={entry.verdict === "accepted" ? "text-pass" : "text-fail"}>{VERDICT_LABEL[entry.verdict] ?? entry.verdict}</span>
              {entry.timeMs !== null && <span className="text-xs text-faint">{entry.timeMs} ms</span>}
              {entry.verdict === "wrong_answer" && (
                <button type="button" onClick={() => onAdopt([index])} className="ml-auto text-xs font-semibold text-brand hover:underline">
                  Use solution output
                </button>
              )}
            </div>
            {entry.verdict === "wrong_answer" && ran(entry.verdict) && (
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <OutputPreview label="Expected (test case)" value={normalizeOutput(tests[index]?.expectedOutput ?? "")} />
                <OutputPreview label="Solution printed" value={normalizeOutput(entry.actual)} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function OutputPreview({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">{label}</p>
      <pre className="max-h-32 overflow-auto rounded-lg bg-sunken px-3 py-2 font-mono text-xs">{value === "" ? "(empty)" : value.slice(0, 2000)}</pre>
    </div>
  );
}
