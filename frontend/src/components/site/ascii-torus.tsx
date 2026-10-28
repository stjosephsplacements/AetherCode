"use client";

import { useEffect, useRef } from "react";

// Brightness ramp, dark to light.
const RAMP = ".,-~:;=!*#$@";

/** One frame of a lit, spinning torus as text: `columns` x `rows` characters. */
function render(a: number, b: number, columns: number, rows: number): string {
  const cells = new Array<string>(columns * rows).fill(" ");
  const depth = new Float32Array(columns * rows);
  const [sinA, cosA, sinB, cosB] = [Math.sin(a), Math.cos(a), Math.sin(b), Math.cos(b)];
  const scale = Math.min(columns, rows * 2) * 0.32;

  for (let theta = 0; theta < 6.283; theta += 0.07) {
    const [sinT, cosT] = [Math.sin(theta), Math.cos(theta)];
    for (let phi = 0; phi < 6.283; phi += 0.02) {
      const [sinP, cosP] = [Math.sin(phi), Math.cos(phi)];
      const circleX = 2 + cosT; // tube radius 1 around a ring of radius 2
      const x = circleX * (cosB * cosP + sinA * sinB * sinP) - sinT * cosA * sinB;
      const y = circleX * (sinB * cosP - sinA * cosB * sinP) + sinT * cosA * cosB;
      const z = 5 + cosA * circleX * sinP + sinT * sinA;
      const inverse = 1 / z;
      const column = Math.floor(columns / 2 + scale * inverse * x * 2);
      const row = Math.floor(rows / 2 - scale * inverse * y);
      const light = cosP * cosT * sinB - cosA * cosT * sinP - sinA * sinT + cosB * (cosA * sinT - cosT * sinA * sinP);
      const index = column + columns * row;
      if (row >= 0 && row < rows && column >= 0 && column < columns && inverse > depth[index]! && light > 0) {
        depth[index] = inverse;
        cells[index] = RAMP[Math.min(RAMP.length - 1, Math.floor(light * 8))]!;
      }
    }
  }

  let text = "";
  for (let row = 0; row < rows; row++) text += cells.slice(row * columns, (row + 1) * columns).join("") + "\n";
  return text;
}

/**
 * A spinning ASCII torus. It writes one text node per frame at about 30fps,
 * pauses off screen and in background tabs, uses a smaller grid on phones,
 * and holds a single still frame for reduced motion.
 */
export function AsciiTorus({ className }: { className?: string }) {
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const narrow = window.matchMedia("(max-width: 767px)").matches;
    const [columns, rows] = narrow ? [72, 40] : [140, 50];
    element.style.setProperty("--columns", String(columns));
    let a = 1;
    let b = 0.5;
    element.textContent = render(a, b, columns, rows);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let last = 0;
    let visible = true;
    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      if (!visible || document.hidden || time - last < 33) return;
      last = time;
      a += 0.035;
      b += 0.018;
      element.textContent = render(a, b, columns, rows);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
    });
    observer.observe(element);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return <pre ref={ref} aria-hidden className={className} />;
}
