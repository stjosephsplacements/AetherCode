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

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  if (functionalConsent()) document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
}

function circleRadius(x: number, y: number) {
  const { innerWidth: w, innerHeight: h } = window;
  return Math.hypot(Math.max(x, w - x), Math.max(y, h - y));
}

/** Circular wipe from the click (View Transitions). Falls back to an instant switch. */
function circleReveal(theme: Theme, x: number, y: number) {
  const root = document.documentElement;
  root.style.setProperty("--theme-x", `${x}px`);
  root.style.setProperty("--theme-y", `${y}px`);
  root.style.setProperty("--theme-r", `${circleRadius(x, y)}px`);

  const start = (document as Document & { startViewTransition?: (update: () => void) => { finished: Promise<unknown> } }).startViewTransition;
  if (typeof start === "function") {
    const transition = start.call(document, () => applyTheme(theme));
    void transition.finished.finally(() => {
      root.style.removeProperty("--theme-x");
      root.style.removeProperty("--theme-y");
      root.style.removeProperty("--theme-r");
    });
    return;
  }

  // No View Transitions: clip-path overlay using the destination canvas colour.
  const overlay = document.createElement("div");
  overlay.setAttribute("aria-hidden", "true");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "99999",
    pointerEvents: "none",
    background: theme === "light" ? "#96998c" : "#0a0a0a",
    clipPath: `circle(0px at ${x}px ${y}px)`,
    transition: "clip-path 480ms cubic-bezier(0.22, 1, 0.36, 1)",
  });
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.style.clipPath = `circle(${circleRadius(x, y)}px at ${x}px ${y}px)`;
  });
  overlay.addEventListener(
    "transitionend",
    () => {
      applyTheme(theme);
      overlay.remove();
    },
    { once: true },
  );
}

/** Switches the theme. Pass the pointer event so the wipe expands from the control. */
export function setTheme(theme: Theme, origin?: { clientX: number; clientY: number } | MouseEvent) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    applyTheme(theme);
    return;
  }
  const x = origin && "clientX" in origin ? origin.clientX : window.innerWidth / 2;
  const y = origin && "clientY" in origin ? origin.clientY : window.innerHeight / 2;
  circleReveal(theme, x, y);
}
