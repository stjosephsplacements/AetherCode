"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

const AUDIENCES = {
  student: {
    label: "I'm a student",
    lede: "Practice like it counts, because the exam will look exactly the same.",
    points: [
      `${SITE.languages.length} languages, from C to Go, in a proper code editor.`,
      "Practice problems, contests and interview stories from seniors, in one place.",
      "Results the moment staff release them, with every test case explained.",
    ],
    cta: { href: "/login", label: "Sign in to practice" },
  },
  college: {
    label: "I run placements",
    lede: "Run fair exams for hundreds of students at once, on your own servers.",
    points: [
      "Safe Exam Browser lockdown and lab-network rules, checked on every request.",
      "Live monitoring, extra time per student, and similarity checks after the exam.",
      "Self-hosted and open source. Your students' data never leaves your servers.",
    ],
    cta: { href: "/architecture", label: "See how it's built" },
  },
} as const;

type Audience = keyof typeof AUDIENCES;

/** Two audiences behind one switch: pick who you are and the page answers you. */
export function AudienceSwitch() {
  const [audience, setAudience] = useState<Audience>("student");
  const current = AUDIENCES[audience];

  return (
    <section className="mx-auto max-w-6xl px-6 py-32">
      <h2 className="display text-[2.6rem] text-ink sm:text-[3.6rem]">Who&apos;s asking?</h2>
      <div role="group" aria-label="Show this for" className="mt-8 inline-flex rounded-full border border-line-strong bg-surface p-1">
        {(Object.keys(AUDIENCES) as Audience[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={audience === key}
            onClick={() => setAudience(key)}
            className={cn("relative rounded-full px-5 py-2.5 text-[15px] font-medium transition-colors", audience === key ? "text-brand-ink" : "text-ink-muted hover:text-ink")}
          >
            {audience === key && <motion.span layoutId="audience-pill" className="absolute inset-0 rounded-full bg-brand" transition={{ type: "spring", bounce: 0.2, duration: 0.5 }} />}
            <span className="relative">{AUDIENCES[key].label}</span>
          </button>
        ))}
      </div>

      <div key={audience} className="mt-14 grid animate-enter gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-20">
        <div>
          <p className="font-serif text-[2rem] leading-[1.15] tracking-tight text-ink sm:text-[2.4rem]">{current.lede}</p>
          <Button asChild size="lg" variant="secondary" className="mt-8">
            <Link href={current.cta.href}>{current.cta.label}</Link>
          </Button>
        </div>
        <ul className="border-t border-line">
          {current.points.map((point) => (
            <li key={point} className="border-b border-line py-6 text-[17px] leading-relaxed text-ink">
              {point}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
