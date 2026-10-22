"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormMessage, type ActionState } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type Test, saveTests } from "../actions";

const blank = (sample: boolean): Test => ({ input: "", expected_output: "", sample, weight: 1 });

/**
 * Test cases are encrypted when saved and never shown again, so this editor
 * always starts empty and saving replaces every existing test.
 */
export function TestsEditor({ versionId, expectedVersion, existing }: { versionId: string; expectedVersion: number; existing: number }) {
  const router = useRouter();
  const [tests, setTests] = useState<Test[]>([blank(true), blank(false)]);
  const [state, setState] = useState<ActionState>({ error: null });
  const [pending, startTransition] = useTransition();

  const update = (index: number, patch: Partial<Test>) => setTests((all) => all.map((test, position) => (position === index ? { ...test, ...patch } : test)));
  const withNewline = (value: string) => (value === "" || value.endsWith("\n") ? value : `${value}\n`);

  function save() {
    startTransition(async () => {
      const prepared = tests.map((test) => ({ ...test, input: withNewline(test.input), expected_output: withNewline(test.expected_output) }));
      const result = await saveTests(versionId, expectedVersion, prepared);
      setState(result);
      if (!result.error) {
        setTests([blank(true), blank(false)]);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      {existing > 0 && (
        <p className="rounded-[var(--radius-control)] bg-hover px-3 py-2 text-[13px] text-ink-muted">
          {existing} tests are saved. They are encrypted and cannot be shown again; saving here replaces all of them.
        </p>
      )}
      {tests.map((test, index) => (
        <div key={index} className={cn("rounded-[var(--radius-control)] border bg-surface p-3", test.sample ? "border-brand/40" : "border-line")}>
          <div className="mb-2 flex flex-wrap items-center gap-3 text-[13px]">
            <span className="font-medium text-ink">Test {index + 1}</span>
            <label className="flex items-center gap-1.5 text-ink-muted">
              <input type="checkbox" checked={test.sample} onChange={(event) => update(index, { sample: event.target.checked })} className="accent-[var(--brand)]" />
              Sample (students see it when they run)
            </label>
            <label className="flex items-center gap-1.5 text-ink-muted">
              Weight
              <input
                type="number"
                min={1}
                max={100}
                value={test.weight}
                onChange={(event) => update(index, { weight: Math.max(1, Math.min(100, Number(event.target.value) || 1)) })}
                className="h-7 w-16 rounded-md border border-line-strong bg-surface px-2 text-ink"
              />
            </label>
            <button
              type="button"
              aria-label={`Remove test ${index + 1}`}
              onClick={() => setTests((all) => all.filter((_, position) => position !== index))}
              disabled={tests.length <= 1}
              className="ml-auto grid size-7 place-items-center rounded-md text-ink-muted hover:bg-hover hover:text-danger disabled:opacity-30"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["input", "expected_output"] as const).map((field) => (
              <label key={field} className="block">
                <span className="mb-1 block text-xs text-ink-muted">{field === "input" ? "Input" : "Expected output"}</span>
                <textarea
                  value={test[field]}
                  onChange={(event) => update(index, { [field]: event.target.value })}
                  spellCheck={false}
                  rows={3}
                  className="w-full rounded-md border border-line-strong bg-canvas p-2 font-mono text-xs text-ink outline-none focus:border-brand"
                />
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setTests((all) => [...all, blank(false)])}>
          <Plus />
          Add test
        </Button>
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? "Saving" : "Save tests"}
        </Button>
        <span className="text-xs text-ink-muted">Marks are shared out by weight. A trailing newline is added to each value.</span>
      </div>
      <FormMessage state={state} />
    </div>
  );
}
