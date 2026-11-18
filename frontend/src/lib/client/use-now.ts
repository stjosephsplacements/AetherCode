"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { serverNow, syncServerClock } from "./api";

let clockSynced = false;

/**
 * The current time on the server's clock (not the laptop's), advancing every `intervalMs`. Null during server
 * rendering and hydration, so server and browser render the same markup.
 */
export function useNow(intervalMs = 1000): number | null {
  // A PC whose clock is wrong would otherwise see every exam as closed until some API call corrected it.
  useEffect(() => {
    if (clockSynced) return;
    clockSynced = true;
    void syncServerClock();
  }, []);
  const subscribe = useCallback(
    (tick: () => void) => {
      const timer = setInterval(tick, intervalMs);
      return () => clearInterval(timer);
    },
    [intervalMs],
  );
  // Rounded to the interval so the snapshot is stable between ticks.
  const snapshot = useCallback(() => Math.floor(serverNow() / intervalMs) * intervalMs, [intervalMs]);
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
