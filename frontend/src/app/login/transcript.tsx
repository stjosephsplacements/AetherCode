import type { CSSProperties } from "react";

// What a student sees on exam day, in order. Marks really do stay hidden until faculty release them.
const LINES = [
  { text: "> Run code", tone: "text-[#ff6a33]" },
  { text: "  [ok] Sample 1   passed   0.03s", tone: "text-[#4ade80]" },
  { text: "  [ok] Sample 2   passed   0.02s", tone: "text-[#4ade80]" },
  { text: "", tone: "" },
  { text: "> Submit code", tone: "text-[#ff6a33]" },
  { text: "  received. grading against hidden tests...", tone: "text-[#a3a3a3]" },
  { text: "  score hidden until results are released", tone: "text-[#a3a3a3]" },
  { text: "", tone: "" },
  { text: "  \\o/  see you on the results page", tone: "text-[#f2f2f2]" },
];

/** Decorative: an exam-day run, one line at a time on load. Screen readers skip it. */
export function Transcript() {
  return (
    <pre aria-hidden className="font-mono text-[13px] leading-7">
      {LINES.map((line, index) => (
        <span
          key={index}
          className={`block min-h-7 animate-[line-in_300ms_ease-out_both] ${line.tone}`}
          style={{ animationDelay: `${400 + index * 260}ms` } as CSSProperties}
        >
          {line.text}
        </span>
      ))}
    </pre>
  );
}
