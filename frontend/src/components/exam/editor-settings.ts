"use client";

import { useSyncExternalStore } from "react";

/** The candidate's editor preferences, kept in this browser only. */
export type EditorSettings = {
  fontSize: 12 | 14 | 16 | 18 | 20;
  tabSize: 2 | 4 | 8;
  autocomplete: boolean;
  theme: "system" | "light" | "dark";
};

const KEY = "aethercode.editor-settings";
const DEFAULTS: EditorSettings = { fontSize: 14, tabSize: 4, autocomplete: false, theme: "system" };

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
    window.localStorage.setItem(KEY, JSON.stringify(current));
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
