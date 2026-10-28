"use client";

import { useEffect, useRef } from "react";

// Sparse to dense.
const RAMP = " .:-=+*#%@";

/**
 * A full-page field of ASCII that flows behind the content: layered sine
 * waves drift with time and scroll. Around the pointer the characters
 * thicken and turn orange, drawn on a second layer that follows the mouse
 * and fades out behind it. One text node per frame at about 30fps; paused in
 * background tabs; coarser on phones; a single still frame for reduced motion.
 */
export function AsciiField() {
  const ref = useRef<HTMLPreElement>(null);
  const glowRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const element = ref.current;
    const glow = glowRef.current;
    if (!element || !glow) return;
    const narrow = window.matchMedia("(max-width: 767px)").matches;
    const columns = narrow ? 64 : 150;
    let rows = 0;
    const pointer = { x: -1, y: -1, strength: 0 };

    const measure = () => {
      element.style.setProperty("--columns", String(columns));
      glow.style.setProperty("--columns", String(columns));
      const cell = element.getBoundingClientRect().width / columns / 0.6;
      rows = Math.ceil(window.innerHeight / cell) + 1;
    };

    const draw = (time: number) => {
      const scroll = window.scrollY / 400;
      let text = "";
      let lit = "";
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const x = column / columns;
          const y = row / rows;
          let value =
            Math.sin(x * 9 + time * 0.6 + scroll) * 0.5 +
            Math.sin(y * 7 - time * 0.4 + x * 3) * 0.35 +
            Math.sin((x + y) * 12 + time * 0.25 - scroll * 2) * 0.25;
          value = (value + 1.1) / 2.2;
          let near = 0;
          if (pointer.strength > 0) {
            const dx = x - pointer.x;
            const dy = (y - pointer.y) * (rows / columns) * 1.7;
            const distance = Math.sqrt(dx * dx + dy * dy);
            near = Math.max(0, 0.08 - distance) * 6 * pointer.strength;
            value += near * 0.6 * (0.7 + 0.3 * Math.sin(distance * 120 - time * 6));
          }
          const index = Math.max(0, Math.min(RAMP.length - 1, Math.floor(value * value * RAMP.length)));
          // Cells by the pointer move to the orange layer; the grey layer leaves a gap there.
          const hot = near > 0.1;
          text += hot ? " " : RAMP[index];
          lit += hot ? RAMP[Math.max(index, 3)] : " ";
        }
        text += "\n";
        lit += "\n";
      }
      element.textContent = text;
      glow.textContent = lit;
    };

    measure();
    draw(0);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      pointer.x = event.clientX / window.innerWidth;
      pointer.y = event.clientY / window.innerHeight;
      pointer.strength = 1;
    };
    const onResize = () => measure();
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("resize", onResize);

    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (document.hidden || now - last < 33) return;
      last = now;
      pointer.strength = Math.max(0, pointer.strength - 0.012);
      draw(now / 1000);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const layer = "ascii-art pointer-events-none fixed inset-0 select-none overflow-hidden [font-size:calc(100vw/var(--columns,150)/0.6)]";
  return (
    <>
      <pre ref={ref} aria-hidden className={`${layer} -z-30 text-ink/[0.07]`} />
      <pre ref={glowRef} aria-hidden className={`${layer} -z-20 text-brand/35`} />
    </>
  );
}
