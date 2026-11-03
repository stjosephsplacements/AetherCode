"use client";

import { CheckCircle, CircleNotch, Plus, ShieldCheck, Trash, WarningCircle, XCircle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { deleteQuestion, saveQuestion } from "@/app/questions/actions";
import { Button, Label, Panel, field } from "@/components/ui";
import { LANGUAGES, type LanguageId } from "@/lib/languages";
import { type Draft } from "@/lib/draft";
import type { Verification } from "@/lib/verify";

const payload = (draft: Draft) => ({
  title: draft.title,
  difficulty: draft.difficulty,
  topics: draft.topics.split(",").map((topic) => topic.trim()).filter(Boolean),
  statement_md: draft.statement_md,
  input_format: draft.input_format,
  output_format: draft.output_format,
  constraints_md: draft.constraints_md,
  time_limit_ms: draft.time_limit_ms,
  memory_limit_kb: draft.memory_limit_kb,
  tests: draft.tests,
  solutions: Object.entries(draft.solutions)
    .filter(([, source]) => (source ?? "").trim() !== "")
    .map(([language, source]) => ({ language, source: source! })),
});

/** What a judge run covers: when this changes, the question has to be verified again. */
const covered = (draft: Draft) => {
  const p = payload(draft);
  return JSON.stringify([p.title.trim(), p.difficulty, p.statement_md, p.time_limit_ms, p.memory_limit_kb, p.tests, [...p.solutions].sort((a, b) => a.language.localeCompare(b.language))]);
};

type Checked = { result: Verification; token: string | null; key: string };

export function QuestionEditor({ id, initial, canDelete }: { id: string | null; initial: Draft; canDelete: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(initial);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [saving, startSaving] = useTransition();
  const [tab, setTab] = useState<LanguageId>(() => (Object.keys(initial.solutions)[0] as LanguageId | undefined) ?? "python");

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const key = useMemo(() => covered(draft), [draft]);
  const fresh = checked !== null && checked.key === key;
  const ready = fresh && checked.token !== null;

  async function verify() {
    setVerifying(true);
    setMessage(null);
    try {
      const response = await fetch("/api/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload(draft)) });
      const body = (await response.json()) as Verification & { token: string | null; error?: string };
      if (!response.ok) {
        setChecked(null);
        setMessage(body.error ?? "The judge could not verify the question.");
        return;
      }
      setChecked({ result: body, token: body.token, key: covered(draft) });
    } catch {
      setMessage("The judge could not be reached. Try again in a moment.");
    } finally {
      setVerifying(false);
    }
  }

  function save() {
    if (!ready) return;
    startSaving(async () => {
      const result = await saveQuestion(id, payload(draft), checked!.token!);
      if ("error" in result) setMessage(result.error);
      else router.push("/");
    });
  }

  const test = (index: number, patch: Partial<Draft["tests"][number]>) => set("tests", draft.tests.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)));
  const languages = Object.keys(LANGUAGES) as LanguageId[];

  return (
    <div className="space-y-5">
      <Panel>
        <div className="grid gap-4 md:grid-cols-[1fr_180px]">
          <div>
            <Label htmlFor="title">Title</Label>
            <input id="title" value={draft.title} onChange={(event) => set("title", event.target.value)} className={field} placeholder="Sum of two numbers" />
          </div>
          <div>
            <Label htmlFor="difficulty">Difficulty</Label>
            <select id="difficulty" value={draft.difficulty} onChange={(event) => set("difficulty", event.target.value as Draft["difficulty"])} className={field}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
        </div>
        <div className="mt-4">
          <Label htmlFor="topics" hint="comma separated">Topics</Label>
          <input id="topics" value={draft.topics} onChange={(event) => set("topics", event.target.value)} className={field} placeholder="arrays, hashing" />
        </div>
      </Panel>

      <Panel>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <Label htmlFor="statement" hint="Markdown">Problem statement</Label>
            <textarea id="statement" value={draft.statement_md} onChange={(event) => set("statement_md", event.target.value)} rows={12} className={`${field} font-mono text-[13px]`} />
          </div>
          <div>
            <Label>Preview</Label>
            <div className="prose-sm h-[calc(100%-26px)] min-h-[260px] overflow-auto rounded-[var(--radius-control)] border border-line bg-surface-2 p-3 text-[14px] leading-relaxed [&_code]:rounded [&_code]:bg-hover [&_code]:px-1 [&_p]:mb-2 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-hover [&_pre]:p-2">
              {draft.statement_md.trim() ? <Markdown remarkPlugins={[remarkGfm]}>{draft.statement_md}</Markdown> : <p className="text-ink-subtle">The statement appears here.</p>}
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <Label htmlFor="input-format">Input format</Label>
            <textarea id="input-format" value={draft.input_format} onChange={(event) => set("input_format", event.target.value)} rows={3} className={field} />
          </div>
          <div>
            <Label htmlFor="output-format">Output format</Label>
            <textarea id="output-format" value={draft.output_format} onChange={(event) => set("output_format", event.target.value)} rows={3} className={field} />
          </div>
          <div>
            <Label htmlFor="constraints">Constraints</Label>
            <textarea id="constraints" value={draft.constraints_md} onChange={(event) => set("constraints_md", event.target.value)} rows={3} className={field} />
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="time" hint="ms per test">Time limit</Label>
            <input id="time" type="number" min={100} max={20000} value={draft.time_limit_ms} onChange={(event) => set("time_limit_ms", Number(event.target.value))} className={field} />
          </div>
          <div>
            <Label htmlFor="memory" hint="KiB">Memory limit</Label>
            <input id="memory" type="number" min={16384} max={2097152} value={draft.memory_limit_kb} onChange={(event) => set("memory_limit_kb", Number(event.target.value))} className={field} />
          </div>
        </div>
      </Panel>

      <Panel>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Tests</h2>
          <Button variant="secondary" onClick={() => set("tests", [...draft.tests, { input: "", expected_output: "", is_sample: false }])}>
            <Plus className="size-3.5" /> Add test
          </Button>
        </div>
        <div className="space-y-3">
          {draft.tests.map((entry, index) => (
            <div key={index} className="rounded-[var(--radius-control)] border border-line p-3">
              <div className="mb-2 flex items-center justify-between text-[13px]">
                <span className="font-mono text-ink-muted">Test {index + 1}</span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-ink-muted">
                    <input type="checkbox" checked={entry.is_sample} onChange={(event) => test(index, { is_sample: event.target.checked })} />
                    Sample (students see it)
                  </label>
                  <button aria-label={`Remove test ${index + 1}`} disabled={draft.tests.length <= 2} onClick={() => set("tests", draft.tests.filter((_, at) => at !== index))} className="text-ink-subtle hover:text-danger disabled:opacity-30">
                    <Trash className="size-4" />
                  </button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <textarea aria-label={`Test ${index + 1} input`} placeholder="Input" value={entry.input} onChange={(event) => test(index, { input: event.target.value })} rows={3} className={`${field} font-mono text-[13px]`} />
                <textarea aria-label={`Test ${index + 1} expected output`} placeholder="Expected output" value={entry.expected_output} onChange={(event) => test(index, { expected_output: event.target.value })} rows={3} className={`${field} font-mono text-[13px]`} />
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <h2 className="mb-3 text-[15px] font-semibold">Model solutions</h2>
        <p className="mb-3 text-[13px] text-ink-muted">The judge runs each solution you add against every test. All of them must pass before the question can be saved.</p>
        <div role="tablist" aria-label="Language" className="mb-3 flex flex-wrap gap-1.5">
          {languages.map((language) => {
            const filled = (draft.solutions[language] ?? "").trim() !== "";
            return (
              <button
                key={language}
                role="tab"
                aria-selected={tab === language}
                onClick={() => setTab(language)}
                className={`rounded-full border px-3 py-1 text-[13px] transition-colors ${tab === language ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line-strong text-ink-muted hover:bg-hover"}`}
              >
                {LANGUAGES[language].label}
                {filled && <span aria-hidden className="ml-1.5 inline-block size-1.5 rounded-full bg-success" />}
              </button>
            );
          })}
        </div>
        <textarea
          aria-label={`${LANGUAGES[tab].label} model solution`}
          value={draft.solutions[tab] ?? ""}
          onChange={(event) => set("solutions", { ...draft.solutions, [tab]: event.target.value })}
          placeholder={LANGUAGES[tab].template}
          rows={14}
          spellCheck={false}
          className={`${field} font-mono text-[13px] leading-relaxed`}
        />
      </Panel>

      {checked && <Result checked={checked} fresh={fresh} />}
      {message && (
        <p role="alert" className="flex items-start gap-2 rounded-[var(--radius-control)] border border-danger/30 bg-danger-soft px-3 py-2 text-[13.5px] text-danger">
          <WarningCircle className="mt-0.5 size-4 shrink-0" />
          {message}
        </p>
      )}

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-full border border-line bg-surface/90 px-4 py-2.5 shadow-[var(--shadow-panel)] backdrop-blur">
        <p className="flex items-center gap-2 text-[13px] text-ink-muted">
          {ready ? (
            <>
              <CheckCircle className="size-4 text-success" weight="fill" /> Verified by the judge. Ready to save.
            </>
          ) : checked && !fresh ? (
            <>
              <WarningCircle className="size-4 text-warning" /> You changed the question after verifying. Verify again.
            </>
          ) : (
            <>
              <ShieldCheck className="size-4" /> Verify with the judge before saving.
            </>
          )}
        </p>
        <div className="flex items-center gap-2">
          {id && canDelete && (
            <Button variant="danger" onClick={() => confirm("Delete this question?") && deleteQuestion(id)}>
              <Trash className="size-3.5" /> Delete
            </Button>
          )}
          <Button variant="secondary" onClick={verify} disabled={verifying || saving}>
            {verifying ? <CircleNotch className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            {verifying ? "Judging..." : "Verify with judge"}
          </Button>
          <Button onClick={save} disabled={!ready || saving}>
            {saving ? "Saving..." : id ? "Save changes" : "Save question"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Result({ checked, fresh }: { checked: Checked; fresh: boolean }) {
  const { result } = checked;
  return (
    <Panel className={fresh ? "" : "opacity-60"} aria-label="Judge result">
      <div className="mb-3 flex items-center gap-2 text-[15px] font-semibold">
        {result.passed ? <CheckCircle className="size-5 text-success" weight="fill" /> : <XCircle className="size-5 text-danger" weight="fill" />}
        {result.passed ? "Every model solution passed every test" : "The judge found problems"}
      </div>
      <div className="space-y-3">
        {result.solutions.map((solution) => (
          <div key={solution.language} className="rounded-[var(--radius-control)] border border-line p-3 text-[13px]">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-medium">{LANGUAGES[solution.language].label}</span>
              <span className={solution.passed ? "text-success" : "text-danger"}>{solution.passed ? "passed" : "failed"}</span>
            </div>
            {solution.compileError ? (
              <pre className="overflow-auto rounded bg-danger-soft p-2 font-mono text-[12px] text-danger">{solution.compileError}</pre>
            ) : (
              <ul className="grid gap-1 sm:grid-cols-2">
                {solution.tests.map((entry) => (
                  <li key={entry.index} className="flex items-center justify-between gap-2 rounded bg-surface-2 px-2 py-1">
                    <span className="font-mono">Test {entry.index + 1}</span>
                    <span className={entry.passed ? "text-success" : "text-danger"}>
                      {entry.passed ? "passed" : entry.status === "ok" ? "wrong answer" : entry.status.replace("_", " ")}
                      {entry.timeMs !== null && <span className="ml-2 text-ink-subtle">{entry.timeMs} ms</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {solution.tests.filter((entry) => !entry.passed && entry.status === "ok").slice(0, 2).map((entry) => (
              <p key={entry.index} className="mt-2 font-mono text-[12px] text-ink-muted">
                Test {entry.index + 1} printed: <span className="text-danger">{entry.actual || "(nothing)"}</span>
              </p>
            ))}
          </div>
        ))}
      </div>
    </Panel>
  );
}
