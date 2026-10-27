"use client";

import { Check, Clock3, LockKeyhole } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const STEPS = [
  { title: "Open your exam", body: "One link, or Safe Exam Browser if your college locks it down. Your timer starts when you press Start." },
  { title: "Code like it's your IDE", body: "A real editor with your language, run against sample tests as often as you like. Your code saves as you type." },
  { title: "Submit and see it land", body: "Hidden tests decide your marks. Each question keeps your best submission, so a late bad one can't hurt you." },
];

/**
 * An exam in three steps. On wide screens the steps stay pinned while a
 * sketch of each screen scrolls past, and the step on screen lights up.
 */
export function ExamStory() {
  const [active, setActive] = useState(0);

  return (
    <section className="mx-auto grid max-w-6xl gap-12 px-6 py-28 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20">
      <div className="lg:sticky lg:top-32 lg:self-start">
        <h2 className="display text-[2.6rem] text-ink sm:text-[3.4rem]">What an exam feels like.</h2>
        <ol className="mt-10 space-y-7">
          {STEPS.map((step, index) => (
            <li key={step.title} className={cn("flex gap-5 transition-opacity duration-500", active !== index && "lg:opacity-40")}>
              <span className={cn("mt-1 font-mono text-[13px] transition-colors duration-500", active === index ? "text-accent" : "text-ink-subtle")}>
                0{index + 1}
              </span>
              <div>
                <h3 className="text-[19px] font-semibold text-ink">{step.title}</h3>
                <p className="mt-1.5 max-w-[30rem] text-[15px] leading-relaxed text-ink-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-6 lg:space-y-0">
        {[StartPanel, CodePanel, VerdictPanel].map((Panel, index) => (
          <motion.div
            key={STEPS[index]!.title}
            aria-hidden
            onViewportEnter={() => setActive(index)}
            viewport={{ amount: 0.6 }}
            className="flex items-center lg:min-h-[64vh]"
          >
            <div className="w-full rounded-[var(--radius-surface)] border border-line bg-surface p-7 shadow-[var(--shadow-panel)] sm:p-9">
              <Panel />
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function StartPanel() {
  return (
    <>
      <p className="text-[13px] text-ink-subtle">Today, 10:00</p>
      <p className="mt-1 text-[22px] font-semibold text-ink">Placement drive, round 1</p>
      <p className="mt-1 text-[15px] text-ink-muted">3 questions in 60 minutes</p>
      <div className="mt-6 flex flex-wrap gap-2 text-[13px]">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-success">
          <LockKeyhole className="size-3.5" />
          Safe Exam Browser verified
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-ink-muted">
          <Clock3 className="size-3.5" />
          Timer starts on Start
        </span>
      </div>
      <div className="mt-8 inline-flex rounded-full bg-brand px-6 py-2.5 text-[15px] font-medium text-brand-ink">Start exam</div>
    </>
  );
}

function CodePanel() {
  return (
    <>
      <div className="flex items-center justify-between text-[13px]">
        <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-ink">main.cpp</span>
        <span className="text-ink-subtle">Saved just now</span>
      </div>
      <pre className="mt-5 overflow-hidden font-mono text-[13.5px] leading-7 text-ink">
        <span className="text-accent">int</span> main() {"{"}
        {"\n"}
        {"  "}
        <span className="text-accent">long long</span> n; cin &gt;&gt; n;
        {"\n"}
        {"  "}cout &lt;&lt; n * (n + <span className="text-coral">1</span>) / <span className="text-coral">2</span>;
        {"\n"}
        {"}"}
      </pre>
      <div className="mt-6 space-y-2 border-t border-line pt-5 text-[14px]">
        {["Sample 1", "Sample 2"].map((name, index) => (
          <div key={name} className="flex items-center gap-3">
            <span className="grid size-5 place-items-center rounded-full bg-success-soft text-success">
              <Check className="size-3" strokeWidth={3} />
            </span>
            <span className="text-ink">{name} passed</span>
            <span className="ml-auto font-mono text-[12.5px] text-ink-subtle">{index ? "0.02s" : "0.01s"}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function VerdictPanel() {
  return (
    <>
      <p className="text-[13px] text-ink-subtle">Question 2, submission 3</p>
      <p className="mt-2 font-serif text-[3.2rem] leading-none text-success">Accepted</p>
      <p className="mt-3 text-[15px] text-ink-muted">12 of 12 hidden tests passed</p>
      <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-[14px]">
        <div className="bg-surface p-4">
          <p className="text-ink-subtle">Marks</p>
          <p className="mt-1 text-[20px] font-semibold text-ink">20 / 20</p>
        </div>
        <div className="bg-surface p-4">
          <p className="text-ink-subtle">Counted</p>
          <p className="mt-1 text-[20px] font-semibold text-ink">Best of 3</p>
        </div>
      </div>
    </>
  );
}
