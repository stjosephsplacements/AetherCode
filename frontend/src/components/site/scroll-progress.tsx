"use client";

import { motion, useScroll } from "motion/react";

/** A thin dusk-coloured bar along the bottom of the screen showing how far down the page you are. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  return (
    <motion.div
      aria-hidden
      style={{ scaleX: scrollYProgress }}
      className="fixed inset-x-0 bottom-0 z-50 h-[3px] origin-left bg-[linear-gradient(to_right,#a99cff,#ff4f79,#ff8a3d,#ffc24b)]"
    />
  );
}
