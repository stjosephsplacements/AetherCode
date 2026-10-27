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
export function BugHunt({ className }: { className?: string }) {
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
        "relative overflow-hidden rounded-[20px] border border-white/10 bg-[#130f27] text-[#f3eeff] shadow-[0_40px_90px_-30px_rgb(0_0_0/0.7)] transition-shadow duration-500",
        solved && "shadow-[0_0_0_1px_rgb(52_211_153/0.5),0_40px_90px_-30px_rgb(52_211_153/0.4)]",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3 text-[12.5px] text-[#8e85ad]">
        <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[#f3eeff]">second_largest.py</span>
        <span>Return the second largest distinct number</span>
      </div>

      <pre className="px-5 pb-2 pt-5 font-mono text-[14px] leading-7">
        <span className="text-[#ff8a3d]">def</span> <span className="text-[#a99cff]">second_largest</span>(nums):{"\n"}
        {"    "}
        <span className="text-[#ff8a3d]">return</span>{" "}
        <span
          key={line}
          className={cn(
            "inline-block animate-pop rounded-md px-1.5",
            line === "bug" ? "bg-[#ff6b7f]/15 text-[#ffa3b1] underline decoration-[#ff6b7f] decoration-wavy underline-offset-4" : solved ? "bg-[#34d399]/15 text-[#6ee7b7]" : "bg-white/[0.08]",
          )}
        >
          {LINES[line].code}
        </span>
      </pre>

      <div className="px-5 pb-5">
        <p className="text-[13px] text-[#8e85ad]">{line === "bug" ? "One test fails. Pick the line that fixes it:" : solved ? "That's the one." : "Not quite. Try another:"}</p>
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
                    ? "border-[#34d399] bg-[#34d399]/15 text-[#6ee7b7]"
                    : "border-[#ff6b7f]/60 bg-[#ff6b7f]/10 text-[#ffa3b1]"
                  : "border-white/15 text-[#f3eeff] hover:border-white/40 hover:bg-white/[0.04]",
              )}
            >
              {LINES[id].code}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-white/[0.08] bg-[#171230] px-5 py-4">
        <table className="w-full text-left font-mono text-[12.5px]">
          <caption className="sr-only">Test results for the chosen line</caption>
          <thead className="text-[#8e85ad]">
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
                  <td className="py-1 text-[#8e85ad]">{test.expected}</td>
                  <td className={cn("py-1", ok ? "text-[#f3eeff]" : "text-[#ffa3b1]")}>{outputs[index]}</td>
                  <td className="py-1 text-right">
                    <span
                      key={`${round}-${index}`}
                      style={{ animationDelay: `${index * 110}ms` } as CSSProperties}
                      className={cn("inline-grid size-5 animate-pop place-items-center rounded-full", ok ? "bg-[#34d399]/20 text-[#34d399]" : "bg-[#ff6b7f]/20 text-[#ff6b7f]")}
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
          <span className={solved ? "font-semibold text-[#34d399]" : "text-[#8e85ad]"}>
            {solved ? "Accepted · 3 of 3 passed" : `${passed} of ${TESTS.length} passed`}
          </span>
          {line !== "bug" && (
            <button type="button" onClick={() => choose("bug")} className="inline-flex items-center gap-1.5 text-[#8e85ad] transition-colors hover:text-[#f3eeff]">
              <RotateCcw className="size-3.5" />
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
