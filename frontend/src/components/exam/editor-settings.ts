"use client";

import { useSyncExternalStore } from "react";

/** The candidate's editor preferences, kept in this browser only. */
export type EditorSettings = {
  fontSize: 12 | 14 | 16 | 18 | 20;
  tabSize: 2 | 4 | 8;
  autocomplete: boolean;
  theme: EditorTheme;
  wordWrap: boolean;
  minimap: boolean;
  lineNumbers: boolean;
};

export const EDITOR_THEMES = [
  { value: "system", label: "Match app", bg: "#171230", fg: "#ff8a3d" },
  { value: "light", label: "Aether light", bg: "#ffffff", fg: "#b34700" },
  { value: "dark", label: "Aether dark", bg: "#171230", fg: "#ff8a3d" },
  { value: "github-light", label: "GitHub light", bg: "#ffffff", fg: "#cf222e" },
  { value: "solarized", label: "Solarized", bg: "#002b36", fg: "#b58900" },
  { value: "dracula", label: "Dracula", bg: "#282a36", fg: "#ff79c6" },
  { value: "monokai", label: "Monokai", bg: "#272822", fg: "#f92672" },
  { value: "nord", label: "Nord", bg: "#2e3440", fg: "#88c0d0" },
  { value: "high-contrast", label: "High contrast", bg: "#000000", fg: "#ffff00" },
] as const;
export type EditorTheme = (typeof EDITOR_THEMES)[number]["value"];

const KEY = "aethercode.editor-settings";
const DEFAULTS: EditorSettings = { fontSize: 14, tabSize: 4, autocomplete: false, theme: "system", wordWrap: false, minimap: false, lineNumbers: true };

let current: EditorSettings | null = null;
const listeners = new Set<() => void>();

function read(): EditorSettings {
  if (current) return current;
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<EditorSettings> | null;
    current = { ...DEFAULTS, ...stored };
  } catch {
    current = DEFAULTS;
  }
  return current;
}

export function updateEditorSettings(patch: Partial<EditorSettings>) {
  current = { ...read(), ...patch };
  try {
    // Remembering preferences across visits is a functional choice (cookie settings).
    if (JSON.parse(window.localStorage.getItem("aether-consent") ?? "{}").functional === true) {
      window.localStorage.setItem(KEY, JSON.stringify(current));
    }
  } catch {
    // Private windows may refuse storage; the setting still applies now.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useEditorSettings(): EditorSettings {
  return useSyncExternalStore(subscribe, read, () => DEFAULTS);
}
