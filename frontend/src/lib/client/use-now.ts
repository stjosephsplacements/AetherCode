"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The current time, advancing every `intervalMs`. Null during server
 * rendering and hydration, so server and browser render the same markup.
 */
export function useNow(intervalMs = 1000): number | null {
  const subscribe = useCallback(
    (tick: () => void) => {
      const timer = setInterval(tick, intervalMs);
      return () => clearInterval(timer);
    },
    [intervalMs],
  );
  // Rounded to the interval so the snapshot is stable between ticks.
  const snapshot = useCallback(() => Math.floor(Date.now() / intervalMs) * intervalMs, [intervalMs]);
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** 1:05:09 or 05:09. */
export function formatCountdown(milliseconds: number): string {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
