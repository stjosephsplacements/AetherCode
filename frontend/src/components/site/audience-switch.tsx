"use client";

import { ArrowUpRight, Check, Clock3, LockKeyhole } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

const STEPS = [
  { title: "Author", body: "Write questions with test cases, build an exam from them and set when it opens and closes.", visual: "author" },
  { title: "Run", body: "Students code and run tests in the browser while staff watch the live monitor and add time where needed.", visual: "exam" },
  { title: "Release", body: "Review submissions and the similarity report, then release results when you're ready.", visual: "results" },
] as const;

export function AudienceSwitch() {
  const [active, setActive] = useState(0);
  const reduce = useReducedMotion();
  const step = STEPS[active]!;
  return (
    <section className="mx-auto max-w-6xl px-6 py-24 sm:py-28" aria-labelledby="workflow-heading">
      <div className="max-w-3xl">
        <h2 id="workflow-heading" className="heading text-[2.3rem] sm:text-[3.1rem] text-ink">From question bank to released results.</h2>
      </div>
      <div className="mt-14 grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
        <div className="flex flex-col justify-center border-t border-line-strong">
          {STEPS.map((item, index) => (
            <div key={item.title} className="border-b border-line-strong">
              <button type="button" aria-expanded={active === index} aria-controls="workflow-preview" onClick={() => setActive(index)} className="flex w-full items-center justify-between gap-4 py-6 text-left">
                <span className={`text-[1.35rem] font-semibold tracking-[-0.02em] transition-colors ${active === index ? "text-ink" : "text-ink-subtle hover:text-ink"}`}>{item.title}</span>
                <span aria-hidden className="font-mono text-xs text-accent">0{index + 1}</span>
              </button>
              {active === index && <p className="max-w-sm pb-6 text-[15px] leading-relaxed text-ink-muted">{item.body}</p>}
            </div>
          ))}
          <Link href="/help" className="mt-8 inline-flex w-fit items-center gap-2 text-sm font-bold text-ink hover:text-accent">Guide for staff <ArrowUpRight aria-hidden className="size-4" /></Link>
        </div>
        <div id="workflow-preview" className="relative flex min-h-[400px] items-center overflow-hidden rounded-[28px] border border-line-strong bg-[image:var(--horizon)] p-5 sm:min-h-[480px] sm:p-12">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={step.visual} initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -14 }} transition={{ duration: 0.25 }} className="w-full rounded-2xl border border-line-strong bg-surface p-5 shadow-[var(--shadow-overlay)] sm:p-7">
              {step.visual === "author" && <><p className="text-[1.6rem] font-semibold tracking-[-0.025em] text-ink">Placement assessment</p><div className="mt-6 space-y-3"><PreviewRow label="Questions" value="3 coding problems" /><PreviewRow label="Duration" value="60 minutes" /><PreviewRow label="Access" value="Safe Exam Browser" /></div></>}
              {step.visual === "exam" && <><div className="flex items-center justify-between gap-4"><p className="text-[1.6rem] font-semibold tracking-[-0.025em] text-ink">Exam in progress</p><Clock3 aria-hidden className="size-5 text-accent" /></div><div className="mt-6 rounded-xl bg-surface-2 p-5 font-mono text-sm leading-7 text-ink"><span className="text-accent">def</span> solve(nums):<br />&nbsp;&nbsp;&nbsp;&nbsp;<span className="text-lavender">return</span> sorted(set(nums))[-2]</div><p className="mt-4 flex items-center gap-2 text-sm text-success"><LockKeyhole aria-hidden className="size-4" /> Safe Exam Browser verified</p></>}
              {step.visual === "results" && <><p className="text-[1.6rem] font-semibold tracking-[-0.025em] text-ink">Results overview</p><div className="mt-6 space-y-3"><PreviewRow label="Submissions" value="Ready to review" /><PreviewRow label="Similarity" value="Report available" /><PreviewRow label="Results" value="Released by staff" /></div><p className="mt-5 flex items-center gap-2 text-sm text-success"><Check aria-hidden className="size-4" /> Review before release</p></>}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-wrap justify-between gap-2 border-b border-line py-3 text-sm"><span className="text-ink-muted">{label}</span><span className="text-ink">{value}</span></div>;
}
