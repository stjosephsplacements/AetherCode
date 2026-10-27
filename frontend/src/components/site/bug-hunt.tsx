"use client";

import { Check, RotateCcw, X } from "lucide-react";
import { type CSSProperties, useState } from "react";
import { cn } from "@/lib/utils";

// Outcomes were computed by running each line in Python, not guessed.
const TESTS = [
  { input: "[3, 1, 2]", expected: "2" },
  { input: "[5, 5, 4]", expected: "4" },
  { input: "[10, 3]", expected: "3" },
];

const LINES = {
  bug: { code: "sorted(nums)[-2]", outputs: ["2", "5", "3"] },
  set: { code: "sorted(set(nums))[-2]", outputs: ["2", "4", "3"] },
  max: { code: "max(nums) - 1", outputs: ["2", "4", "9"] },
  index: { code: "sorted(nums)[1]", outputs: ["2", "5", "10"] },
} as const;

type LineId = keyof typeof LINES;
const CHOICES: LineId[] = ["max", "set", "index"];

/** A one-click debugging puzzle: pick the fix, watch the tests flip. Nothing is executed. */
export function BugHunt({ className, onSolvedChange }: { className?: string; onSolvedChange?: (solved: boolean) => void }) {
  const [line, setLine] = useState<LineId>("bug");
  const [round, setRound] = useState(0);
  const outputs = LINES[line].outputs;
  const passed = outputs.filter((output, index) => output === TESTS[index]!.expected).length;
  const solved = passed === TESTS.length;

  const choose = (id: LineId) => {
    setLine(id);
    onSolvedChange?.(LINES[id].outputs.every((output, index) => output === TESTS[index]!.expected));
    setRound((current) => current + 1);
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[20px] border border-line bg-surface text-ink shadow-[var(--shadow-overlay)] transition-shadow duration-500",
        solved && "shadow-[0_0_0_1px_var(--success),var(--shadow-overlay)]",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3 text-[12.5px] text-ink-subtle">
        <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-ink">second_largest.py</span>
        <span>Return the second largest distinct number</span>
      </div>

      <pre className="px-5 pb-2 pt-5 font-mono text-[14px] leading-7">
        <span className="text-accent">def</span> <span className="text-lavender">second_largest</span>(nums):{"\n"}
        {"    "}
        <span className="text-accent">return</span>{" "}
        <span
          key={line}
          className={cn(
            "inline-block animate-pop rounded-md px-1.5",
            line === "bug" ? "bg-danger-soft text-danger underline decoration-danger decoration-wavy underline-offset-4" : solved ? "bg-success-soft text-success" : "bg-surface-2",
          )}
        >
          {LINES[line].code}
        </span>
      </pre>

      <div className="px-5 pb-5">
        <p className="text-[13px] text-ink-subtle">{line === "bug" ? "One test fails. Pick the line that fixes it:" : solved ? "That's the one." : "Not quite. Try another:"}</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {CHOICES.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => choose(id)}
              aria-pressed={line === id}
              className={cn(
                "rounded-full border px-3.5 py-1.5 font-mono text-[13px] transition-colors duration-200",
                line === id
                  ? solved
                    ? "border-success bg-success-soft text-success"
                    : "border-danger/60 bg-danger-soft text-danger"
                  : "border-line-strong text-ink hover:bg-hover",
              )}
            >
              {LINES[id].code}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-line bg-surface-2 px-5 py-4">
        <table className="w-full text-left font-mono text-[12.5px]">
          <caption className="sr-only">Test results for the chosen line</caption>
          <thead className="text-ink-subtle">
            <tr>
              <th className="pb-2 font-normal">input</th>
              <th className="pb-2 font-normal">expected</th>
              <th className="pb-2 font-normal">yours</th>
              <th className="pb-2 text-right font-normal">
                <span className="sr-only">result</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {TESTS.map((test, index) => {
              const ok = outputs[index] === test.expected;
              return (
                <tr key={test.input}>
                  <td className="py-1">{test.input}</td>
                  <td className="py-1 text-ink-subtle">{test.expected}</td>
                  <td className={cn("py-1", ok ? "text-ink" : "text-danger")}>{outputs[index]}</td>
                  <td className="py-1 text-right">
                    <span
                      key={`${round}-${index}`}
                      style={{ animationDelay: `${index * 110}ms` } as CSSProperties}
                      className={cn("inline-grid size-5 animate-pop place-items-center rounded-full", ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}
                    >
                      {ok ? <Check className="size-3" strokeWidth={3} aria-label="passed" /> : <X className="size-3" strokeWidth={3} aria-label="failed" />}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-[13px]" aria-live="polite">
          <span className={solved ? "font-semibold text-success" : "text-ink-subtle"}>
            {solved ? "Accepted · 3 of 3 passed" : `${passed} of ${TESTS.length} passed`}
          </span>
          {line !== "bug" && (
            <button type="button" onClick={() => choose("bug")} className="inline-flex items-center gap-1.5 text-ink-subtle transition-colors hover:text-ink">
              <RotateCcw className="size-3.5" />
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
