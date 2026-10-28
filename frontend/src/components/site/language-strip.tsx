"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { SITE } from "@/lib/site";

/** The judge's languages in giant pixel type, two rows sliding opposite ways as the page scrolls. */
export function LanguageStrip() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const left = useTransform(scrollYProgress, [0, 1], reduce ? ["-10%", "-10%"] : ["0%", "-35%"]);
  const right = useTransform(scrollYProgress, [0, 1], reduce ? ["-25%", "-25%"] : ["-45%", "-10%"]);
  const row = [...SITE.languages, ...SITE.languages, ...SITE.languages];

  return (
    <section ref={ref} aria-label={`Languages: ${SITE.languages.join(", ")}`} className="overflow-hidden py-16 sm:py-24">
      <motion.p aria-hidden style={{ x: left }} className="pixel whitespace-nowrap text-[3.6rem] leading-none text-ink sm:text-[6.5rem]">
        {row.map((language, index) => (
          <span key={index} className="mr-[0.6em]">
            {language}
            <span className="ml-[0.6em] text-accent">/</span>
          </span>
        ))}
      </motion.p>
      <motion.p aria-hidden style={{ x: right }} className="pixel mt-4 whitespace-nowrap text-[3.6rem] leading-none text-transparent [-webkit-text-stroke:1px_var(--ink-subtle)] sm:text-[6.5rem]">
        {row.map((language, index) => (
          <span key={index} className="mr-[0.6em]">
            {language}
            <span className="ml-[0.6em]">/</span>
          </span>
        ))}
      </motion.p>
    </section>
  );
}
