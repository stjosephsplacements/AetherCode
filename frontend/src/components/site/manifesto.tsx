"use client";

import { Braces, GraduationCap, Laptop, type LucideIcon, Users } from "lucide-react";
import { type MotionValue, motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";

// The sentence, with small picture pills dropped between the words.
const TOKENS: (string | { icon: LucideIcon; tone: string })[] = [
  ..."Your marks should depend on the code you write.".split(" "),
  { icon: Braces, tone: "bg-[#0f0b1e] text-[#ff8a3d]" },
  ..."Not the college you're from,".split(" "),
  { icon: GraduationCap, tone: "bg-[#fbf8f4] text-[#0f0b1e]" },
  ..."the laptop you own,".split(" "),
  { icon: Laptop, tone: "bg-[#a99cff] text-[#0f0b1e]" },
  ..."or who you know.".split(" "),
  { icon: Users, tone: "bg-[#0f0b1e] text-[#ffc24b]" },
];

/** One sentence on an amber sheet that fills in word by word as it scrolls through the screen. */
export function Manifesto() {
  const ref = useRef<HTMLParagraphElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.9", "end 0.7"] });

  return (
    <section className="px-2 pb-8 sm:px-4">
      <div className="grain mx-auto max-w-[1500px] overflow-hidden rounded-[32px] bg-[#ff8a3d] px-6 py-28 sm:rounded-[48px] sm:py-40">
        <p ref={ref} className="relative z-[2] mx-auto max-w-5xl text-center font-serif text-[2.2rem] leading-[1.18] tracking-tight text-[#0f0b1e] sm:text-[3.6rem] lg:text-[4.4rem]">
          {TOKENS.map((token, index) => (
            <Token key={index} progress={scrollYProgress} range={[index / TOKENS.length, (index + 1) / TOKENS.length]} still={!!reduce}>
              {typeof token === "string" ? (
                token
              ) : (
                <span aria-hidden className={`inline-grid h-[0.78em] w-[1.6em] -translate-y-[0.06em] place-items-center rounded-full align-middle ${token.tone}`}>
                  <token.icon className="size-[0.42em]" strokeWidth={2.25} />
                </span>
              )}
            </Token>
          ))}
        </p>
      </div>
    </section>
  );
}

function Token({ children, progress, range, still }: { children: React.ReactNode; progress: MotionValue<number>; range: [number, number]; still: boolean }) {
  const opacity = useTransform(progress, range, [still ? 1 : 0.2, 1]);
  return (
    <>
      <motion.span style={{ opacity }}>{children}</motion.span>{" "}
    </>
  );
}
