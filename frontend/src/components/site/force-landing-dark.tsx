"use client";

import { useEffect } from "react";
import { THEME_COOKIE } from "@/lib/theme";

/**
 * The marketing home stays dark: no light palette, no theme flash while
 * visitors are on `/`. Other routes keep the viewer's saved preference.
 */
export function ForceLandingDark() {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.theme === "dark" ? "dark" : "light";
    root.dataset.theme = "dark";
    return () => {
      const saved = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=(dark|light)`))?.[1];
      root.dataset.theme = saved === "dark" || saved === "light" ? saved : previous;
    };
  }, []);
  return null;
}
