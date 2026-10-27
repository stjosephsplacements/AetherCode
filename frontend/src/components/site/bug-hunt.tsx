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
export function BugHunt() {
  const [line, setLine] = useState<LineId>("bug");
  const [round, setRound] = useState(0);
  const outputs = LINES[line].outputs;
  const passed = outputs.filter((output, index) => output === TESTS[index]!.expected).length;
  const solved = passed === TESTS.length;

  const choose = (id: LineId) => {
    setLine(id);
    setRound((current) => current + 1);
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[20px] border border-white/10 bg-[#0e141e] text-[#e6edf3] shadow-[0_40px_90px_-30px_rgb(14_20_30/0.6)] transition-shadow duration-500",
        solved && "shadow-[0_0_0_1px_rgb(5_199_112/0.5),0_40px_90px_-30px_rgb(5_199_112/0.45)]",
      )}
    >
      <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3 text-[12.5px] text-[#8794a0]">
        <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[#e6edf3]">second_largest.py</span>
        <span>Return the second largest distinct number</span>
      </div>

      <pre className="px-5 pb-2 pt-5 font-mono text-[14px] leading-7">
        <span className="text-[#05c770]">def</span> <span className="text-[#73d3fb]">second_largest</span>(nums):{"\n"}
        {"    "}
        <span className="text-[#05c770]">return</span>{" "}
        <span
          key={line}
          className={cn(
            "inline-block animate-pop rounded-md px-1.5",
            line === "bug" ? "bg-[#f87171]/15 text-[#fca5a5] underline decoration-[#f87171] decoration-wavy underline-offset-4" : solved ? "bg-[#05c770]/15 text-[#aef96c]" : "bg-white/[0.08]",
          )}
        >
          {LINES[line].code}
        </span>
      </pre>

      <div className="px-5 pb-5">
        <p className="text-[13px] text-[#8794a0]">{line === "bug" ? "One test fails. Pick the line that fixes it:" : solved ? "That's the one." : "Not quite. Try another:"}</p>
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
                    ? "border-[#05c770] bg-[#05c770]/15 text-[#aef96c]"
                    : "border-[#f87171]/60 bg-[#f87171]/10 text-[#fca5a5]"
                  : "border-white/15 text-[#e6edf3] hover:border-white/40 hover:bg-white/[0.04]",
              )}
            >
              {LINES[id].code}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-white/[0.08] bg-[#141c28] px-5 py-4">
        <table className="w-full text-left font-mono text-[12.5px]">
          <caption className="sr-only">Test results for the chosen line</caption>
          <thead className="text-[#8794a0]">
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
                  <td className="py-1 text-[#8794a0]">{test.expected}</td>
                  <td className={cn("py-1", ok ? "text-[#e6edf3]" : "text-[#fca5a5]")}>{outputs[index]}</td>
                  <td className="py-1 text-right">
                    <span
                      key={`${round}-${index}`}
                      style={{ animationDelay: `${index * 110}ms` } as CSSProperties}
                      className={cn("inline-grid size-5 animate-pop place-items-center rounded-full", ok ? "bg-[#05c770]/20 text-[#05c770]" : "bg-[#f87171]/20 text-[#f87171]")}
                    >
                      {ok ? <Check className="size-3" strokeWidth={3} aria-label="passed" /> : <X className="size-3" strokeWidth={3} aria-label="failed" />}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-3 flex items-center justify-between border-t border-white/[0.08] pt-3 text-[13px]" aria-live="polite">
          <span className={solved ? "font-semibold text-[#05c770]" : "text-[#8794a0]"}>
            {solved ? "Accepted · 3 of 3 passed" : `${passed} of ${TESTS.length} passed`}
          </span>
          {line !== "bug" && (
            <button type="button" onClick={() => choose("bug")} className="inline-flex items-center gap-1.5 text-[#8794a0] transition-colors hover:text-[#e6edf3]">
              <RotateCcw className="size-3.5" />
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
