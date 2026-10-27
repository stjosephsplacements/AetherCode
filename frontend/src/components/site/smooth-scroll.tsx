"use client";

import "lenis/dist/lenis.css";
import { ReactLenis } from "lenis/react";
import { useReducedMotion } from "motion/react";

/** Eased page scrolling for the public pages; plain native scroll for anyone who asked for less motion. */
export function SmoothScroll({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  if (reduce) return <>{children}</>;
  return (
    <ReactLenis root options={{ lerp: 0.09, wheelMultiplier: 0.9 }}>
      {children}
    </ReactLenis>
  );
}
