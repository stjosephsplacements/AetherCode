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

/** Switches the theme now and remembers it for server renders (one year). */
export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
}
