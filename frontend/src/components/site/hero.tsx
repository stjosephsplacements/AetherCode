"use client";

import { ArrowRight } from "lucide-react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import Link from "next/link";
import { useRef } from "react";
import { SITE } from "@/lib/site";

/**
 * The landing hero: a white halo like an eclipse, faint
 * drifting stars, the line set in a pixel face, and the two next steps
 * pinned to the bottom corners. Scrolling away swells the halo out of
 * frame and lifts the headline; reduced motion keeps it still.
 */
export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const still = (from: number | string, to: number | string) => (reduce ? from : to);
  const haloScale = useTransform(scrollYProgress, [0, 1], [1, still(1, 1.6) as number]);
  const haloOpacity = useTransform(scrollYProgress, [0, 0.8], [1, still(1, 0) as number]);
  const starsY = useTransform(scrollYProgress, [0, 1], ["0%", still("0%", "25%") as string]);
  const textY = useTransform(scrollYProgress, [0, 1], ["0%", still("0%", "-40%") as string]);
  const textOpacity = useTransform(scrollYProgress, [0, 0.6], [1, still(1, 0) as number]);
  const textBlur = useTransform(scrollYProgress, [0, 0.6], ["blur(0px)", still("blur(0px)", "blur(10px)") as string]);

  return (
    <section ref={ref} className="relative isolate -mt-[76px] flex min-h-[100svh] flex-col overflow-hidden bg-canvas text-ink">
      <motion.div aria-hidden style={{ y: starsY }} className="stars absolute inset-0 -z-10" />
      <motion.div aria-hidden style={{ scale: haloScale, opacity: haloOpacity }} className="absolute inset-0 -z-10 origin-center">
        <div className="halo absolute left-1/2 top-[14%] aspect-square w-[min(118vw,1100px)] rounded-full sm:top-[10%]" />
      </motion.div>
      <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-[45%] bg-[linear-gradient(to_top,var(--canvas)_25%,transparent)]" />

      <motion.div style={{ y: textY, opacity: textOpacity, filter: textBlur }} className="flex flex-1 flex-col items-center justify-center px-6 pt-28 text-center">
        <p className="pixel text-[12px] uppercase tracking-[0.28em] text-ink-muted">Coding exams for colleges</p>
        <h1 className="pixel mt-7 max-w-[16ch] text-balance text-[2.7rem] leading-[1.02] sm:text-[4.6rem] lg:text-[5.6rem]">
          {SITE.tagline}
          <span aria-hidden className="ml-2 inline-block h-[0.8em] w-[0.42em] translate-y-[0.08em] cursor-blink animate-[blink_1.1s_steps(1)_infinite] bg-[#ff5a1f]" />
        </h1>
      </motion.div>

      <div className="relative flex flex-col gap-8 px-6 pb-10 sm:flex-row sm:items-end sm:justify-between sm:px-10">
        <p className="pixel max-w-[34ch] text-[12.5px] leading-[1.7] text-ink-muted">
          Timed coding exams with sandboxed judging and Safe Exam Browser lockdown, from the St. Joseph&apos;s Placements and
          Training Cell and AlgoQX.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/system-check" className="pixel rounded-[10px] px-4 py-3 text-[13px] text-ink-muted ring-1 ring-line-strong transition-colors hover:bg-hover hover:text-ink">
            Check my laptop
          </Link>
          <Link href="/login" className="group inline-flex items-center gap-3 rounded-[10px] bg-surface py-1 pl-1 pr-5 ring-1 ring-line-strong transition-colors hover:bg-hover">
            <span className="grid size-10 place-items-center rounded-[8px] bg-[#ff5a1f] text-[#050505]">
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
            <span className="pixel text-[13.5px]">Sign in to your exams</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
