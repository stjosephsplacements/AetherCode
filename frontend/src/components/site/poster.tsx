"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import Link from "next/link";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { SITE } from "@/lib/site";

/**
 * The finale, framed like a film poster: letterboxed, grainy, a dusk sun
 * rising over the horizon as you reach it, and a billing block of real
 * numbers instead of a cast list.
 */
export function Poster() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end end"] });
  const sun = useTransform(scrollYProgress, [0, 1], [reduce ? "0%" : "40%", "0%"]);
  const title = useTransform(scrollYProgress, [0.3, 1], [reduce ? 1 : 1.08, 1]);

  return (
    <section ref={ref} className="bg-black px-0 py-10 sm:py-16">
      <div className="grain relative mx-auto flex min-h-[86vh] max-w-[1400px] flex-col items-center justify-between overflow-hidden bg-[linear-gradient(to_bottom,#0f0b1e_0%,#2a1640_38%,#8a2f4f_66%,#ff7a45_88%,#ffc27a_100%)] px-6 py-14 text-center text-[#f3eeff]">
        <motion.div
          aria-hidden
          style={{ y: sun }}
          className="absolute bottom-[-36%] left-1/2 size-[min(64vw,640px)] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,#ffe0a8_0%,#ffb35c_38%,rgb(255_122_69/0)_70%)]"
        />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-[16%] bg-[linear-gradient(to_bottom,rgb(15_11_30/0),#0f0b1e)]" />

        <p className="relative z-[2] text-[13px] tracking-[0.3em] text-[#f3eeff]/70">AetherCode presents</p>

        <div className="relative z-[2]">
          <motion.h2 style={{ scale: title }} className="display text-[4rem] leading-[0.9] sm:text-[7rem] lg:text-[9.5rem]">
            Placement season.
          </motion.h2>
          <p className="mt-6 font-serif text-[1.4rem] italic text-[#f3eeff]/85 sm:text-[1.8rem]">{SITE.tagline}</p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="bg-[#f3eeff] text-[#0f0b1e] hover:bg-white">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="lg" variant="ghost" className="text-[#f3eeff] hover:bg-white/10 hover:text-white">
              <Link href="/help">How it works</Link>
            </Button>
          </div>
        </div>

        <p className="relative z-[2] mx-auto max-w-[62rem] text-[11.5px] leading-[1.6] tracking-[0.04em] text-[#f3eeff]/85 [font-stretch:condensed] sm:text-[12.5px]">
          A St. Joseph&apos;s Placements and Training Cell and AlgoQX production. Starring {SITE.stats.students} students,{" "}
          {SITE.stats.runs} code runs and {SITE.languages.length} languages. One editor, one judge, zero excuses. Open source
          under the {SITE.license}. Now showing in your college lab.
        </p>
      </div>
    </section>
  );
}
