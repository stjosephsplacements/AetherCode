"use client";

import { Moon, Sun } from "@phosphor-icons/react/ssr";
import { usePathname } from "next/navigation";
import { setTheme, useTheme } from "@/lib/theme";
import { openCookieSettings } from "./consent";

export function ThemeSwitch() {
  const pathname = usePathname();
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  if (pathname === "/") return null;
  return (
    <button
      type="button"
      onClick={(event) => setTheme(next, event.nativeEvent)}
      className="inline-flex h-8 items-center gap-2 rounded-pill border border-line-strong px-3 text-[13px] text-ink-muted transition-colors hover:bg-hover hover:text-ink"
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

/** The theme switch as an icon button, for the header. */
export function ThemeIcon() {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={(event) => setTheme(next, event.nativeEvent)}
      aria-label={`Switch to ${next} theme`}
      className="grid size-8 place-items-center rounded-pill text-ink-muted transition-colors hover:bg-hover hover:text-ink"
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
