"use client";

import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";
export const THEME_COOKIE = "aether-theme";

function current(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

/** The app theme, kept in sync with <html data-theme>. Light on the server. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, current, () => "light");
}

function functionalConsent(): boolean {
  try {
    return JSON.parse(localStorage.getItem("aether-consent") ?? "{}").functional === true;
  } catch {
    return false;
  }
}

const RAMP = " .:-=+*#%@";

function asciiDissolve(onMidpoint: () => void) {
  const overlay = document.createElement("pre");
  overlay.setAttribute("aria-hidden", "true");
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", zIndex: "99999",
    pointerEvents: "none", margin: "0", overflow: "hidden",
    fontFamily: "monospace", lineHeight: "1",
    fontSize: `${Math.max(10, window.innerWidth / 120 / 0.6)}px`,
    background: "transparent", color: "var(--brand)",
  });
  document.body.appendChild(overlay);

  const cols = Math.ceil(window.innerWidth / (window.innerWidth / 120));
  const rows = Math.ceil(window.innerHeight / (window.innerWidth / 120 / 0.6)) + 1;
  const total = cols * rows;
  const order = Array.from({ length: total }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }

  const cells = new Array(total).fill(" ");
  const duration = 400;
  let start = 0;
  let fired = false;

  const frame = (now: number) => {
    if (!start) start = now;
    const elapsed = now - start;
    const t = Math.min(elapsed / duration, 1);

    if (t <= 0.5) {
      const progress = t / 0.5;
      const count = Math.floor(progress * total);
      for (let i = 0; i < count; i++) cells[order[i]!] = RAMP[Math.floor(Math.random() * RAMP.length)];
    } else {
      if (!fired) { fired = true; onMidpoint(); }
      const progress = (t - 0.5) / 0.5;
      const count = Math.floor(progress * total);
      for (let i = 0; i < count; i++) cells[order[i]!] = " ";
    }

    let text = "";
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) text += cells[r * cols + c];
      text += "\n";
    }
    overlay.textContent = text;

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      overlay.remove();
    }
  };
  requestAnimationFrame(frame);
}

/** Switches the theme with an ASCII dissolve transition. */
export function setTheme(theme: Theme) {
  const apply = () => {
    document.documentElement.dataset.theme = theme;
    if (functionalConsent()) document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
  };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    apply();
    return;
  }
  asciiDissolve(apply);
}
