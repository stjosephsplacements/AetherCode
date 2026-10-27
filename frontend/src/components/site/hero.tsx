"use client";

import { Clock3 } from "lucide-react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import Link from "next/link";
import { useRef } from "react";
import { BugHunt } from "@/components/site/bug-hunt";
import { Button } from "@/components/ui/button";
import { SITE } from "@/lib/site";

/**
 * The landing hero: the headline, then the exam screen itself. The window
 * starts tilted back like a laptop lid and swings flat as it scrolls into
 * view; its editor is a puzzle you can play. Reduced motion shows it flat.
 */
export function Hero() {
  const windowRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: windowRef, offset: ["start end", "start 0.25"] });

  const tilt = useTransform(scrollYProgress, [0, 1], [reduce ? 0 : 26, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [reduce ? 1 : 0.9, 1]);
  const lift = useTransform(scrollYProgress, [0, 1], [reduce ? 0 : 60, 0]);
  const horizon = useTransform(scrollYProgress, [0, 1], [reduce ? 1 : 0.35, 1]);

  return (
    <section className="relative isolate overflow-hidden">
      <motion.div aria-hidden style={{ opacity: horizon }} className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[78%] bg-[image:var(--horizon)]" />

      <div className="mx-auto flex max-w-5xl flex-col items-center px-6 pt-20 text-center sm:pt-28">
        <h1 className="display text-balance text-[3.2rem] leading-[0.98] text-ink sm:text-[5rem] lg:text-[6rem]">
          {SITE.tagline.split(" ").map((word, index) => (
            <span key={`${word}-${index}`} className="rise inline-block" style={{ animationDelay: `${80 + index * 70}ms` }}>
              {word}&nbsp;
            </span>
          ))}
        </h1>
        <p className="rise mt-7 max-w-[36rem] text-[17.5px] leading-[1.7] text-ink-muted [animation-delay:520ms]">
          Coding exams and practice for colleges, built by students. Same exam, same judge, same fair shot, whichever college
          you&apos;re from.
        </p>
        <div className="rise mt-9 flex flex-wrap justify-center gap-3 [animation-delay:600ms]">
          <Button asChild size="lg">
            <Link href="/login">Sign in to your exams</Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href="/system-check">Check my laptop</Link>
          </Button>
        </div>
      </div>

      <div className="mx-auto mt-16 max-w-6xl px-4 pb-24 sm:mt-20 sm:px-6 [perspective:1600px]">
        <motion.div ref={windowRef} style={{ rotateX: tilt, scale, y: lift }} className="origin-top">
          <ExamWindow />
        </motion.div>
      </div>
    </section>
  );
}

/** A faithful sketch of the exam screen: the brief on the left, the editor and tests on the right. */
function ExamWindow() {
  return (
    <div className="overflow-hidden rounded-[22px] border border-white/10 bg-[#130f27] text-left text-[#f3eeff] shadow-[0_1px_0_rgb(255_255_255/0.06)_inset,0_60px_120px_-40px_rgb(15_11_30/0.75)]">
      <div className="flex items-center gap-4 border-b border-white/[0.08] px-5 py-3 text-[13px]">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
        </span>
        <span className="font-medium">Placement drive, round 1</span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 font-mono text-[12.5px] text-[#ffb784]">
          <Clock3 className="size-3.5" aria-hidden />
          42:17 left
        </span>
      </div>
      <div className="grid md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <article className="border-b border-white/[0.08] p-6 md:border-b-0 md:border-r sm:p-7">
          <p className="text-[12.5px] text-[#8e85ad]">Question 2 of 3, 20 marks</p>
          <h2 className="mt-2 text-[20px] font-semibold">Second largest</h2>
          <p className="mt-3 text-[14.5px] leading-relaxed text-[#a89fc4]">
            Given a list of integers, return the second largest <em className="not-italic text-[#f3eeff]">distinct</em> value. The
            list always holds at least two distinct numbers.
          </p>
          <div className="mt-5 rounded-xl bg-white/[0.04] p-4 font-mono text-[12.5px] leading-6 text-[#a89fc4]">
            <div>
              <span className="text-[#8e85ad]">Input </span>
              <span className="text-[#f3eeff]">[5, 5, 4]</span>
            </div>
            <div>
              <span className="text-[#8e85ad]">Output </span>
              <span className="text-[#f3eeff]">4</span>
            </div>
          </div>
          <p className="mt-5 text-[13px] text-[#8e85ad]">Hidden tests decide your marks. Your best submission counts.</p>
        </article>
        <BugHunt className="rounded-none border-0 shadow-none" />
      </div>
    </div>
  );
}
