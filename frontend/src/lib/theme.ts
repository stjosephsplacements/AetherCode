"use client";

import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";
export const THEME_COOKIE = "aether-theme";

function current(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

/** The app theme, kept in sync with <html data-theme>. Dark on the server. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, current, () => "dark");
}

function functionalConsent(): boolean {
  try {
    return JSON.parse(localStorage.getItem("aether-consent") ?? "{}").functional === true;
  } catch {
    return false;
  }
}

/** Switches the theme now, and remembers it for server renders (one year) when allowed. */
export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  // Remembering it is a functional cookie: only with consent.
  if (functionalConsent()) document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
}
