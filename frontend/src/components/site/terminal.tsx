"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { LiquidGlass } from "./liquid-glass";

export function Terminal({ title, commands }: { title: string; commands: string[] }) {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard client-only mount gate
  useEffect(() => setMounted(true), []);

  return (
    <LiquidGlass strong className="overflow-hidden rounded-3xl shadow-[var(--shadow-overlay)]">
      <div className="flex items-center gap-1.5 border-b border-line px-4 py-3" aria-hidden>
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="ml-3 text-[12.5px] text-ink-subtle">{title}</span>
      </div>
      {mounted ? (
        <motion.pre initial="hidden" whileInView="shown" viewport={{ once: true, amount: 0.6 }} className="overflow-x-auto p-6 font-mono text-[13px] leading-7">
          {commands.map((command, index) => (
            <motion.div
              key={command}
              variants={{ hidden: { clipPath: "inset(0 100% 0 0)" }, shown: { clipPath: "inset(0 0% 0 0)" } }}
              transition={{ duration: 0.55, delay: reduce ? 0 : 0.2 + index * 0.6, ease: "linear" }}
              className="text-ink"
            >
              <span className="select-none text-accent">$ </span>
              {command}
            </motion.div>
          ))}
        </motion.pre>
      ) : (
        <pre className="overflow-x-auto p-6 font-mono text-[13px] leading-7">
          {commands.map((command) => (
            <div key={command} className="text-ink">
              <span className="select-none text-accent">$ </span>
              {command}
            </div>
          ))}
        </pre>
      )}
    </LiquidGlass>
  );
}
