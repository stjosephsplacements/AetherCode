"use client";

import { motion, useReducedMotion } from "motion/react";
import { SITE } from "@/lib/site";

const STATS = [
  { value: SITE.stats.students, label: "students have taken exams here" },
  { value: SITE.stats.runs, label: "code runs judged" },
  { value: String(SITE.languages.length), label: "languages, compiled and sandboxed" },
];

/** The numbers, set huge; each one rolls up into place like an odometer when it scrolls in. */
export function Numbers() {
  const reduce = useReducedMotion();
  return (
    <section aria-label="AetherCode in numbers" className="relative">
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(to_right,transparent,var(--line-strong),transparent)]" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(to_right,transparent,var(--line-strong),transparent)]" />
      <dl className="mx-auto grid max-w-7xl md:grid-cols-3">
        {STATS.map((stat, statIndex) => (
          <div key={stat.label} className="flex flex-col-reverse border-line px-6 py-8 not-first:border-t md:border-l md:border-t-0 md:px-10 md:py-16 md:first:border-l-0">
            <dt className="mt-4 text-[15px] text-ink-muted">{stat.label}</dt>
            <motion.dd
              aria-label={stat.value}
              initial={reduce ? false : "hidden"}
              whileInView="shown"
              viewport={{ once: true, amount: 0.5 }}
              className="flex overflow-hidden bg-[linear-gradient(100deg,var(--ink)_35%,var(--accent))] bg-clip-text text-[4.2rem] font-bold leading-[1.05] tracking-[-0.05em] text-transparent lg:text-[5.4rem]"
            >
              {[...stat.value].map((char, index) => (
                <motion.span
                  key={index}
                  aria-hidden
                  variants={{ hidden: { y: "105%" }, shown: { y: "0%" } }}
                  transition={{ duration: 0.9, delay: statIndex * 0.12 + index * 0.05, ease: [0.16, 1, 0.3, 1] }}
                  className="inline-block whitespace-pre bg-[inherit] bg-clip-text"
                >
                  {char}
                </motion.span>
              ))}
            </motion.dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
