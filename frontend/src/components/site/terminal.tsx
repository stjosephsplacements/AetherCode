"use client";

import { motion, useReducedMotion } from "motion/react";

/** A terminal in the theme's colours whose commands type out one after another the first time it scrolls into view. */
export function Terminal({ title, commands }: { title: string; commands: string[] }) {
  const reduce = useReducedMotion();
  return (
    <div className="overflow-hidden rounded-[18px] border border-line-strong bg-surface shadow-[var(--shadow-overlay)]">
      <div className="flex items-center gap-1.5 border-b border-line px-4 py-3" aria-hidden>
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="ml-3 text-[12.5px] text-ink-subtle">{title}</span>
      </div>
      <motion.pre initial={reduce ? false : "hidden"} whileInView="shown" viewport={{ once: true, amount: 0.6 }} className="overflow-x-auto p-6 font-mono text-[13px] leading-7">
        {commands.map((command, index) => (
          <motion.div
            key={command}
            variants={{ hidden: { clipPath: "inset(0 100% 0 0)" }, shown: { clipPath: "inset(0 0% 0 0)" } }}
            transition={{ duration: 0.55, delay: 0.2 + index * 0.6, ease: "linear" }}
            className="text-ink"
          >
            <span className="select-none text-accent">$ </span>
            {command}
          </motion.div>
        ))}
      </motion.pre>
    </div>
  );
}
