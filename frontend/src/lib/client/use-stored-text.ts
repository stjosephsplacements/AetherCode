"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Text kept for this visit, and across visits only when the cookie settings allow functional storage. */
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function functionalConsent(): boolean {
  try {
    return JSON.parse(window.localStorage.getItem("aether-consent") ?? "{}").functional === true;
  } catch {
    return false;
  }
}

function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    return functionalConsent() ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  memory.set(key, value);
  try {
    if (functionalConsent()) window.localStorage.setItem(key, value);
  } catch {
    // A private window may refuse storage; the text still lives for this visit.
  }
  for (const listener of listeners) listener();
}

/** A string that survives a refresh (with consent) and is shared by every user of the same key. */
export function useStoredText(key: string, fallback: string): [string, (value: string) => void] {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  const value = useSyncExternalStore(
    subscribe,
    () => read(key) ?? fallback,
    () => fallback,
  );
  return [value, useCallback((next: string) => write(key, next), [key])];
}
