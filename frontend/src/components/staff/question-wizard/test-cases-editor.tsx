"use client";

import { Copy, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Checkbox, TextArea, TextInput } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type TestDraft, LIMITS, blankTest, marksShare, summarizeTests, testsProblem } from "./model";

const firstLine = (value: string) => value.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
const lines = (value: string) => (value === "" ? 0 : value.replace(/\n$/, "").split("\n").length);

/**
 * Edits the test cases of a coding question: a list on the left, the selected
 * test on the right. Controlled, so the wizard and the replace-tests dialog
 * can both own the state. Shows what is still wrong, but never blocks typing.
 */
export function TestCasesEditor({ tests, onChange }: { tests: TestDraft[]; onChange: (tests: TestDraft[]) => void }) {
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, tests.length - 1);
  const current = tests[index];
  const summary = summarizeTests(tests);
  const problem = testsProblem(tests);

  const update = (patch: Partial<TestDraft>) => onChange(tests.map((test, position) => (position === index ? { ...test, ...patch } : test)));
  const add = (test: TestDraft) => {
    onChange([...tests, test]);
    setSelected(tests.length);
  };
  const remove = () => {
    onChange(tests.filter((_, position) => position !== index));
    setSelected(Math.max(0, index - 1));
  };

  return (
    <div className="space-y-3">
      <div className="grid overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface md:grid-cols-[260px_minmax(0,1fr)]">
        <div className="flex flex-col border-b border-line md:border-b-0 md:border-r">
          <ul className="max-h-72 flex-1 divide-y divide-line overflow-y-auto md:max-h-[26rem]" aria-label="Tests">
            {tests.map((test, position) => (
              <li key={position}>
                <button
                  type="button"
                  aria-current={position === index ? "true" : undefined}
                  onClick={() => setSelected(position)}
                  className={cn("relative flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-hover", position === index && "bg-surface-2")}
                >
                  <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", position === index ? "bg-brand" : "bg-transparent")} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
                      Test {position + 1}
                      <span className={cn("rounded-full px-2 py-px font-mono text-[10.5px] uppercase tracking-[0.04em]", test.sample ? "bg-brand-soft text-brand-soft-ink" : "bg-hover text-ink-muted")}>
                        {test.sample ? "Sample" : "Hidden"}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11.5px] text-ink-subtle">{firstLine(test.input) || "empty input"}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-ink-muted">{marksShare(test, tests)}%</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 border-t border-line p-3">
            <Button type="button" variant="secondary" size="sm" className="flex-1" onClick={() => add(blankTest(false))}>
              <Plus />
              Hidden
            </Button>
            <Button type="button" variant="secondary" size="sm" className="flex-1" onClick={() => add(blankTest(true))}>
              <Plus />
              Sample
            </Button>
          </div>
        </div>

        {current ? (
          <div className="min-w-0 space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Test {index + 1}</h3>
              <label className="flex items-center gap-2 text-[13px] text-ink-muted">
                <Checkbox checked={current.sample} onCheckedChange={(checked) => update({ sample: checked === true })} />
                Sample, students see it when they run
              </label>
              <label className="flex items-center gap-2 text-[13px] text-ink-muted">
                Weight
                <TextInput
                  type="number"
                  min={LIMITS.weight.min}
                  max={LIMITS.weight.max}
                  value={current.weight}
                  onChange={(event) => update({ weight: Math.round(Number(event.target.value)) || LIMITS.weight.min })}
                  className="h-8 w-24"
                  aria-label={`Weight of test ${index + 1}`}
                />
              </label>
              <div className="ml-auto flex gap-1">
                <button
                  type="button"
                  aria-label={`Duplicate test ${index + 1}`}
                  onClick={() => add({ ...current })}
                  className="grid size-8 place-items-center rounded-[var(--radius-control)] text-ink-muted transition-colors hover:bg-hover hover:text-ink"
                >
                  <Copy className="size-4" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  aria-label={`Remove test ${index + 1}`}
                  onClick={remove}
                  disabled={tests.length <= 1}
                  className="grid size-8 place-items-center rounded-[var(--radius-control)] text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:pointer-events-none disabled:opacity-30"
                >
                  <Trash2 className="size-4" strokeWidth={1.75} />
                </button>
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {(
                [
                  ["input", "Input", "What the program reads from standard input."],
                  ["expected_output", "Expected output", "Compared line by line with what the program prints."],
                ] as const
              ).map(([field, label, hint]) => (
                <div key={field} className="space-y-1.5">
                  <label htmlFor={`test-${index}-${field}`} className="flex items-baseline justify-between text-[13px] font-medium text-ink">
                    {label}
                    <span className="font-mono text-[11px] font-normal text-ink-subtle">{lines(current[field])} lines</span>
                  </label>
                  <TextArea
                    id={`test-${index}-${field}`}
                    value={current[field]}
                    onChange={(event) => update({ [field]: event.target.value })}
                    spellCheck={false}
                    className="min-h-44 font-mono text-[13px]"
                  />
                  <p className="text-xs text-ink-muted">{hint}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid place-items-center p-10 text-sm text-ink-muted">Add a test to begin.</div>
        )}
      </div>

      <p className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[12.5px]", problem ? "text-warning" : "text-ink-muted")} role="status">
        <span className="font-mono tabular-nums">
          {summary.sample} sample, {summary.hidden} hidden
        </span>
        <span>{problem ?? "Marks are shared out by weight. A trailing newline is added to each value."}</span>
      </p>
    </div>
  );
}
