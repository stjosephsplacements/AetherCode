"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { WORDMARK } from "./wordmark";

const NOISE = "*/#%@!?+=<>";
const LINES = WORDMARK.split("\n");
const WIDTH = Math.max(...LINES.map((line) => line.length));

/** The wordmark with the face in orange and the extruded shadow dimmed. */
function Art({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((line, row) => (
        <span key={row} className="block">
          {line.split(/(\*+|\/+)/).map((run, index) =>
            run.startsWith("*") ? (
              <span key={index} className="text-brand">
                {run}
              </span>
            ) : run.startsWith("/") ? (
              <span key={index} className="text-ink-subtle/60">
                {run}
              </span>
            ) : (
              run
            ),
          )}
          {"​"}
        </span>
      ))}
    </>
  );
}

/**
 * The AetherCode wordmark in figlet 3-d type. On load the letters decode
 * out of ASCII noise from left to right; hovering scrambles and re-forms
 * them. The server renders the finished art, and reduced motion keeps it.
 */
export function AsciiWordmark({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const [lines, setLines] = useState(LINES);
  const running = useRef(false);

  const decode = useCallback(() => {
    if (running.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    running.current = true;
    const started = performance.now();
    const duration = 1100;
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      const settled = progress * (WIDTH + 12) - 12;
      setLines(
        LINES.map((line) =>
          [...line]
            .map((char, column) => (char === " " || column < settled ? char : NOISE[Math.floor(Math.random() * NOISE.length)]))
            .join(""),
        ),
      );
      if (progress < 1) requestAnimationFrame(step);
      else {
        setLines(LINES);
        running.current = false;
      }
    };
    requestAnimationFrame(step);
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(decode);
    return () => cancelAnimationFrame(id);
  }, [decode]);

  return (
    <pre aria-hidden onPointerEnter={decode} className={cn("ascii-art text-left", className)} style={style}>
      <Art lines={lines} />
    </pre>
  );
}
