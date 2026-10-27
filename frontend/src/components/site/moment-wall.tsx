"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { cn } from "@/lib/utils";

// Real screens from an exam day, as cards on a ring.
const MOMENTS = [
  { tone: "bg-[#ff8a3d]", big: "Accepted", small: "12 of 12 hidden tests passed", serif: true },
  { tone: "bg-[#a99cff]", big: "Saved just now", small: "main.cpp" },
  { tone: "bg-[#34d399]", big: "Wi-Fi back.", small: "All changes synced" },
  { tone: "bg-[#ff4f79]", big: "42:17", small: "left in round 1", mono: true },
  { tone: "bg-[#fbf8f4]", big: "Results are out", small: "Placement drive, round 1" },
  { tone: "bg-[#ffc24b]", big: "Sample 2 passed", small: "in 0.02s", mono: true },
  { tone: "bg-[#ffb784]", big: "Best of 3", small: "submissions counted" },
  { tone: "bg-[#c9c1ff]", big: "Run", small: "as often as you like" },
];

/**
 * The cut to black: the section pins while exam-day moments orbit on a ring
 * behind the line, turning with the scroll. Reduced motion holds the ring still.
 */
export function MomentWall() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const turn = useTransform(scrollYProgress, [0, 1], [reduce ? -10 : 30, reduce ? -10 : -200]);

  return (
    <section ref={ref} className="relative h-[220vh] bg-[#0f0b1e]">
      <div className="grain sticky top-0 flex h-dvh items-center justify-center overflow-hidden">
        <div aria-hidden className="absolute inset-0 [--r:290px] [perspective:1300px] sm:[--r:440px] lg:[--r:580px]">
          <motion.div style={{ rotateY: turn, rotateX: -10 }} className="absolute left-1/2 top-[66%] [transform-style:preserve-3d]">
            {MOMENTS.map((moment, index) => (
              <div
                key={moment.big}
                style={{ transform: `rotateY(${(index * 360) / MOMENTS.length}deg) translateZ(var(--r))` }}
                className={cn(
                  "absolute -left-[120px] -top-[64px] w-[240px] rounded-[22px] px-6 py-5 text-[#0f0b1e] [backface-visibility:hidden] sm:-left-[140px] sm:w-[280px]",
                  moment.tone,
                )}
              >
                <p className={cn("text-[1.9rem] leading-none", moment.serif && "font-serif text-[2.5rem]", moment.mono && "font-mono font-semibold", !moment.serif && !moment.mono && "font-semibold tracking-tight")}>
                  {moment.big}
                </p>
                <p className="mt-2 text-[14px] opacity-75">{moment.small}</p>
              </div>
            ))}
          </motion.div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-[16%] z-[2] px-6 text-center">
          <h2 className="display mx-auto max-w-[14ch] text-[3.2rem] text-[#f3eeff] [text-shadow:0_8px_40px_rgb(15_11_30/0.9)] sm:text-[5.4rem]">Every run counts.</h2>
          <p className="mx-auto mt-5 max-w-[28rem] text-[16px] leading-relaxed text-[#d8d0f0] [text-shadow:0_2px_16px_rgb(15_11_30/0.95)]">
            From the first Run to the last Submit, you always know where you stand.
          </p>
        </div>
      </div>
    </section>
  );
}
