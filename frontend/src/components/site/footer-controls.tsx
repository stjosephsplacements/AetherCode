"use client";

import { Moon, Sun } from "lucide-react";
import { setTheme, useTheme } from "@/lib/theme";
import { openCookieSettings } from "./consent";

export function ThemeSwitch() {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="inline-flex h-8 items-center gap-2 rounded-full border border-line-strong px-3 text-[13px] text-ink-muted transition-colors hover:bg-hover hover:text-ink"
    >
      {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
      {theme === "dark" ? "Light theme" : "Dark theme"}
    </button>
  );
}

export function CookieSettingsLink() {
  return (
    <button type="button" onClick={openCookieSettings} className="text-left text-ink-muted transition-colors hover:text-ink">
      Cookie settings
    </button>
  );
}

/** The theme switch as a bracketed word, for the header. */
export function ThemeIcon() {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      className="font-mono text-ink-muted transition-colors hover:text-ink"
    >
      [{next}]
    </button>
  );
}
