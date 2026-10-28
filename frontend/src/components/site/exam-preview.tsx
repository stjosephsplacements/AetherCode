"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { Check, Clock3, Loader2 } from "lucide-react";
import { useRef } from "react";

// The solution as lines of [tone, text] pairs; an empty tone is plain text.
const CODE: [string, string][][] = [
  [["kw", "def"], ["", " "], ["fn", "second_largest"], ["", "(nums):"]],
  [["", "    "], ["kw", "return"], ["", " sorted("], ["fn", "set"], ["", "(nums))[-"], ["nu", "2"], ["", "]"]],
  [],
  [["", "n = "], ["fn", "int"], ["", "("], ["fn", "input"], ["", "())"]],
  [["", "nums = "], ["fn", "list"], ["", "("], ["fn", "map"], ["", "("], ["fn", "int"], ["", ", "], ["fn", "input"], ["", "().split()))"]],
  [["fn", "print"], ["", "(second_largest(nums))"]],
];

const TONE: Record<string, string> = { kw: "text-accent", fn: "text-lavender", nu: "text-coral" };

const SAMPLES = [
  { name: "Sample 1", input: "3\n3 1 2", output: "2" },
  { name: "Sample 2", input: "3\n5 5 4", output: "4" },
];

/**
 * The student exam screen, rebuilt from its real parts: timer and End test
 * in the header, the question on the left, the editor and the console on
 * the right. The first time it scrolls into view it plays one Run: the
 * button presses, the samples run, and each one turns Passed.
 */
export function ExamPreview() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.set("[data-state=list], [data-state=running], [data-state=passed], [data-state=summary]", { autoAlpha: 0 });
        const timeline = gsap.timeline({ scrollTrigger: { trigger: root.current, start: "top 60%", once: true } });
        timeline
          .to("[data-run]", { scale: 0.94, duration: 0.12, ease: "power2.in" }, 0.6)
          .to("[data-run]", { scale: 1, duration: 0.25, ease: "back.out(3)" })
          .to("[data-state=idle]", { autoAlpha: 0, duration: 0.15 }, "<")
          .to("[data-state=list], [data-state=running]", { autoAlpha: 1, duration: 0.15 }, "<")
          .to("[data-row='0'] [data-state=running]", { autoAlpha: 0, duration: 0.15 }, "+=0.7")
          .to("[data-row='0'] [data-state=passed]", { autoAlpha: 1, duration: 0.2 }, "<")
          .to("[data-row='1'] [data-state=running]", { autoAlpha: 0, duration: 0.15 }, "+=0.45")
          .to("[data-row='1'] [data-state=passed]", { autoAlpha: 1, duration: 0.2 }, "<")
          .to("[data-state=summary]", { autoAlpha: 1, duration: 0.3 }, "+=0.1");
      });
      // Reduced motion: show the finished run.
      media.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set("[data-state=idle], [data-state=running]", { autoAlpha: 0 });
      });
      return () => media.revert();
    },
    { scope: root },
  );

  return (
    <div ref={root} aria-hidden className="overflow-hidden rounded-[14px] border border-line-strong bg-canvas text-left text-ink shadow-[0_0_0_1px_var(--line),0_40px_120px_-40px_rgb(0_0_0/0.45)]">
      <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5 text-[13px]">
        <span className="font-semibold">AetherCode</span>
        <span className="text-ink-subtle">/</span>
        <span className="truncate text-ink-muted">Placement drive, round 1</span>
        <span className="ml-auto inline-flex items-center gap-1.5 font-mono tabular-nums">
          <Clock3 className="size-3.5 text-ink-subtle" />
          42:17
        </span>
        <span className="rounded-[7px] border border-line-strong px-2.5 py-1 text-[12.5px]">End test</span>
      </div>

      <div className="grid md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
        <article className="hidden border-r border-line p-6 md:block">
          <p className="text-[12.5px] text-ink-subtle">Question 2 of 3</p>
          <h3 className="mt-2 text-[19px] font-semibold tracking-[-0.01em]">Second largest</h3>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-muted">
            Read n, then n integers. Print the second largest distinct value. The input always holds at least two distinct numbers.
          </p>
          <p className="mt-5 text-[12.5px] font-medium">Sample input</p>
          <pre className="mt-1.5 rounded-[8px] bg-surface-2 px-3 py-2 font-mono text-[12.5px] leading-6">{"3\n5 5 4"}</pre>
          <p className="mt-3 text-[12.5px] font-medium">Sample output</p>
          <pre className="mt-1.5 rounded-[8px] bg-surface-2 px-3 py-2 font-mono text-[12.5px] leading-6">4</pre>
        </article>

        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-3 border-b border-line px-4 py-2 text-[12.5px]">
            <span className="rounded-[7px] border border-line-strong px-2.5 py-1">Python 3</span>
            <span className="ml-auto inline-flex items-center gap-1 text-ink-subtle">
              <Check className="size-3.5" />
              Saved
            </span>
          </div>
          <pre className="flex-1 overflow-hidden px-0 py-4 font-mono text-[13px] leading-6">
            {CODE.map((line, index) => (
              <div key={index} className="flex">
                <span className="w-10 shrink-0 select-none pr-4 text-right text-ink-subtle/60">{index + 1}</span>
                <span className="whitespace-pre">
                  {line.map(([tone, text], part) => (
                    <span key={part} className={TONE[tone]}>
                      {text}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </pre>

          <div className="border-t border-line bg-surface">
            <div className="flex gap-4 border-b border-line px-4 text-[12.5px]">
              <span className="border-b-2 border-ink py-2 font-medium">Test results</span>
              <span className="py-2 text-ink-subtle">Custom input</span>
            </div>
            <div className="relative px-4 py-3 text-[13px]">
              <p data-state="idle" className="text-ink-subtle">
                Run your code to check it against the sample tests.
              </p>
              <div data-state="list" className="absolute inset-x-4 top-3 space-y-2">
                {SAMPLES.map((sample, index) => (
                  <div key={sample.name} data-row={index} className="relative flex items-center gap-2.5">
                    <span className="relative grid size-5 place-items-center">
                      <Loader2 data-state="running" className="absolute size-4 animate-spin text-ink-subtle" />
                      <span data-state="passed" className="absolute grid size-5 place-items-center rounded-full bg-success-soft text-success">
                        <Check className="size-3" strokeWidth={3} />
                      </span>
                    </span>
                    <span>{sample.name}</span>
                    <span className="font-mono text-[12px] text-ink-subtle">expected {sample.output}</span>
                    <span data-state="passed" className="ml-auto text-success">
                      Passed
                    </span>
                  </div>
                ))}
              </div>
              <div className="h-[52px]" />
            </div>
            <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
              <span data-state="summary" className="text-[13px] font-medium text-success">
                2 of 2 sample tests passed
              </span>
              <span data-run className="ml-auto rounded-[8px] border border-line-strong px-3 py-1.5 text-[13px] font-medium">
                Run code
              </span>
              <span className="rounded-[8px] bg-brand px-3 py-1.5 text-[13px] font-medium text-brand-ink">Submit code</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
