"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import Link from "next/link";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { SITE } from "@/lib/site";

/**
 * The finale, set like a film poster: a grainy full-bleed dusk sky that
 * fades in from the page, the sun rising at the bottom as you reach it, and
 * a billing block of real numbers instead of a cast list.
 */
export function Poster() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end end"] });
  const sun = useTransform(scrollYProgress, [0, 1], [reduce ? "0%" : "30%", "0%"]);
  const title = useTransform(scrollYProgress, [0.3, 1], [reduce ? 1 : 1.08, 1]);

  return (
    <section
      ref={ref}
      className="grain relative overflow-hidden bg-[image:var(--poster-sky)] [mask-image:linear-gradient(to_bottom,transparent,black_18vh,black_calc(100%-20vh),transparent)]"
    >
      <motion.div
        aria-hidden
        style={{ y: sun }}
        className="absolute bottom-[-34vw] left-1/2 size-[70vw] max-h-[900px] max-w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,#ffe7b8_0%,#ffb35c_34%,rgb(255_122_69/0)_70%)] sm:bottom-[-420px]"
      />

      <div className="relative z-[2] mx-auto flex min-h-[85vh] max-w-6xl flex-col items-center justify-center px-6 pb-48 pt-32 text-center text-[var(--poster-ink)] sm:pb-64 sm:pt-40">
        <p className="text-[14px] tracking-[0.08em] opacity-75">AetherCode presents</p>
        <motion.h2 style={{ scale: title }} className="display mt-6 text-[4rem] leading-[0.9] sm:text-[7rem] lg:text-[9.5rem]">
          Placement season.
        </motion.h2>
        <p className="mt-6 font-serif text-[1.4rem] italic opacity-90 sm:text-[1.8rem]">{SITE.tagline}</p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" className="bg-[var(--poster-ink)] text-[var(--poster-on-ink)] hover:opacity-90">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="lg" variant="ghost" className="border border-[color-mix(in_srgb,var(--poster-ink)_28%,transparent)] bg-[color-mix(in_srgb,var(--poster-ink)_8%,transparent)] text-[var(--poster-ink)] backdrop-blur hover:bg-[color-mix(in_srgb,var(--poster-ink)_16%,transparent)] hover:text-[var(--poster-ink)]">
            <Link href="/#pricing">For colleges</Link>
          </Button>
        </div>
        <p className="mt-14 max-w-[46rem] text-[12.5px] leading-[1.7] tracking-[0.02em] opacity-85 sm:text-[13px]">
          A St. Joseph&apos;s Placements and Training Cell and AlgoQX production. Starring {SITE.stats.students} students,{" "}
          {SITE.stats.runs} code runs and {SITE.languages.length} languages. One editor, one judge, zero excuses. Open source
          under the {SITE.license}. Now showing in your college lab.
        </p>
      </div>
    </section>
  );
}
