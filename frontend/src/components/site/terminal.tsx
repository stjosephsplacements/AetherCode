"use client";

import { motion, useReducedMotion } from "motion/react";

/** A dark terminal whose commands type out one after another the first time it scrolls into view. */
export function Terminal({ title, commands }: { title: string; commands: string[] }) {
  const reduce = useReducedMotion();
  return (
    <div className="overflow-hidden rounded-[18px] border border-white/10 bg-[#0f0f0f] shadow-[0_40px_80px_-30px_rgb(0_0_0/0.7)]">
      <div className="flex items-center gap-1.5 border-b border-white/[0.08] px-4 py-3" aria-hidden>
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="ml-3 text-[12.5px] text-[#8a8a8a]">{title}</span>
      </div>
      <motion.pre initial={reduce ? false : "hidden"} whileInView="shown" viewport={{ once: true, amount: 0.6 }} className="overflow-x-auto p-6 font-mono text-[13px] leading-7">
        {commands.map((command, index) => (
          <motion.div
            key={command}
            variants={{ hidden: { clipPath: "inset(0 100% 0 0)" }, shown: { clipPath: "inset(0 0% 0 0)" } }}
            transition={{ duration: 0.55, delay: 0.2 + index * 0.6, ease: "linear" }}
            className="text-[#f2f2f2]"
          >
            <span className="select-none text-[#ff6a33]">$ </span>
            {command}
          </motion.div>
        ))}
      </motion.pre>
    </div>
  );
}
