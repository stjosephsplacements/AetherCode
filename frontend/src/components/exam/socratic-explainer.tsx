"use client";

import type { AttemptResult } from "@/lib/api-types";

/** Rule-based reflection prompts after release (ADR-0081 B). No LLM. */
export function SocraticExplainer({ items }: { items: Extract<AttemptResult, { released: true }>["items"] }) {
  const prompts = items.flatMap((item) => promptsFor(item));
  if (prompts.length === 0) return null;
  return (
    <section className="mt-8 rounded-surface border border-line bg-surface p-5 text-left">
      <h2 className="text-[15px] font-semibold text-ink">Reflect on your work</h2>
      <p className="mt-1 text-[13px] text-ink-muted">Short prompts to help you study from this attempt. They are not official marking feedback.</p>
      <ul className="mt-4 space-y-3 text-[14px] leading-relaxed text-ink">
        {prompts.map((prompt) => (
          <li key={prompt} className="rounded-control bg-sunken px-4 py-3">
            {prompt}
          </li>
        ))}
      </ul>
    </section>
  );
}

function promptsFor(item: Extract<AttemptResult, { released: true }>["items"][number]) {
  const title = item.title ?? "this question";
  const lines: string[] = [];
  const tests = item.tests ?? [];
  const failed = tests.filter((test) => test.verdict !== "accepted");
  if (tests.length === 0) {
    if (Number(item.score) >= Number(item.maximum_score)) {
      lines.push(`You earned full marks on ${title}. What approach would you reuse on a harder variant?`);
    }
    return lines;
  }
  if (failed.length === 0) {
    lines.push(`Every test passed on ${title}. Which edge case would you test next if the time limit doubled?`);
    return lines;
  }
  const kinds = new Set(failed.map((test) => test.verdict));
  if (kinds.has("wrong_answer")) {
    lines.push(`Some tests on ${title} returned the wrong answer. Walk through one failing case on paper before changing code.`);
  }
  if (kinds.has("time_limit_exceeded")) {
    lines.push(`Time ran out on ${title}. Where is the slowest step in your solution?`);
  }
  if (kinds.has("runtime_error") || kinds.has("compile_error")) {
    lines.push(`${title} crashed or failed to compile. What invariant did the judge output suggest?`);
  }
  if (lines.length === 0) {
    lines.push(`Not every test passed on ${title}. Compare your logic with the samples, then one failing test.`);
  }
  return lines;
}