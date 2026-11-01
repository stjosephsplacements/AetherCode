import { TIME_ZONE } from "./utils";

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });

export type CalendarDay = { key: string; inMonth: boolean };

/** "2026-10" for the month containing an instant, in college time. */
export function monthOf(instant: Date): string {
  return dayKey.format(instant).slice(0, 7);
}

/** A "YYYY-MM" query value, or null when it is not a real month. */
export function parseMonth(value: string | undefined): string | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value ?? "");
  return match ? match[0] : null;
}

export function shiftMonth(month: string, by: number): string {
  const [year, number] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, number - 1 + by, 1)).toISOString().slice(0, 7);
}

/** The weeks (Monday first) that cover a month, as day keys. */
export function monthGrid(month: string): CalendarDay[][] {
  const [year, number] = month.split("-").map(Number) as [number, number];
  const first = Date.UTC(year, number - 1, 1);
  const offset = (new Date(first).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const weeks: CalendarDay[][] = [];
  for (let week = 0; week * 7 < offset + days; week++) {
    weeks.push(
      Array.from({ length: 7 }, (_, column) => {
        const key = new Date(first + (week * 7 + column - offset) * 86_400_000).toISOString().slice(0, 10);
        return { key, inMonth: key.startsWith(month) };
      }),
    );
  }
  return weeks;
}

/** Every college day a window touches, first to last. */
export function daysOfWindow(opensAt: string, closesAt: string): string[] {
  const first = dayKey.format(new Date(opensAt));
  const last = dayKey.format(new Date(closesAt));
  const days: string[] = [];
  for (let key = first; key <= last && days.length < 62; key = new Date(Date.parse(key) + 86_400_000).toISOString().slice(0, 10)) days.push(key);
  return days;
}

export type Window = { opensAt: string; closesAt: string };

/** Pairs of windows that overlap in time, earliest opening first. */
export function overlappingPairs<T extends Window>(windows: T[]): [T, T][] {
  const sorted = [...windows].sort((a, b) => Date.parse(a.opensAt) - Date.parse(b.opensAt));
  const pairs: [T, T][] = [];
  for (let first = 0; first < sorted.length; first++) {
    for (let second = first + 1; second < sorted.length; second++) {
      // Sorted by opening, so once one opens after `first` closes, so does every later one.
      if (Date.parse(sorted[second]!.opensAt) >= Date.parse(sorted[first]!.closesAt)) break;
      pairs.push([sorted[first]!, sorted[second]!]);
    }
  }
  return pairs;
}

/** The stretch two overlapping windows share. */
export function sharedWindow(a: Window, b: Window): Window {
  return {
    opensAt: Date.parse(a.opensAt) >= Date.parse(b.opensAt) ? a.opensAt : b.opensAt,
    closesAt: Date.parse(a.closesAt) <= Date.parse(b.closesAt) ? a.closesAt : b.closesAt,
  };
}
