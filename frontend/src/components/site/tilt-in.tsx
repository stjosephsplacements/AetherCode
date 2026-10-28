"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";

/** Swings up from a tilt as it scrolls into view, tied to the scroll so it moves only when you do. */
export function TiltIn({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [reduce ? 0 : 28, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [reduce ? 1 : 0.88, 1]);
  const opacity = useTransform(scrollYProgress, [0, 0.5], [reduce ? 1 : 0.2, 1]);
  return (
    <div className={`[perspective:1400px] ${className ?? ""}`}>
      <motion.div ref={ref} style={{ rotateX, scale, opacity }} className="origin-bottom">
        {children}
      </motion.div>
    </div>
  );
}
