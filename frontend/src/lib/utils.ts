import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Exam times are shown in the college's time zone, not the server's: the
 * dashboard renders on a server that may run in UTC.
 */
export const TIME_ZONE = process.env.NEXT_PUBLIC_TIME_ZONE ?? "Asia/Kolkata";

const day = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: TIME_ZONE });
const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: TIME_ZONE });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });
const parts = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: TIME_ZONE });

export function formatDateTime(value: string | Date): string {
  const date = new Date(value);
  return `${day.format(date)}, ${time.format(date)}`;
}

export function formatTime(value: string | Date): string {
  return time.format(new Date(value));
}

/** "Mon, 21 Oct, 1:30 pm to 4:30 pm", or both dates when the window spans days. */
export function formatWindow(from: string, until: string): string {
  const start = new Date(from);
  const end = new Date(until);
  const sameDay = dayKey.format(start) === dayKey.format(end);
  return `${formatDateTime(start)} to ${sameDay ? time.format(end) : formatDateTime(end)}`;
}

/** Day and month for a date tile: ["21", "Oct"]. */
export function dateTile(value: string): [string, string] {
  const [dayOfMonth = "", month = ""] = parts.format(new Date(value)).split(" ");
  return [dayOfMonth, month];
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours && minutes) return `${hours} h ${minutes} min`;
  return hours ? `${hours} h` : `${minutes} min`;
}

/** Judge language keys as students know them. */
const LANGUAGE_NAMES: Record<string, string> = {
  c: "C",
  cpp17: "C++17",
  java: "Java",
  python3: "Python 3",
  javascript: "JavaScript",
  go: "Go",
};

export function languageName(key: string): string {
  return LANGUAGE_NAMES[key] ?? key;
}

/** Monaco's language id for a judge language key. */
export function editorLanguage(key: string): string {
  if (key.startsWith("cpp")) return "cpp";
  if (key.startsWith("python")) return "python";
  return key;
}

/** The offset of TIME_ZONE from UTC at an instant, in milliseconds. */
function zoneOffset(instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second")) - instant;
}

/** A datetime-local value ("2026-10-21T10:00"), read as college time, as an ISO instant. */
export function collegeTimeToISO(local: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) throw new Error("Enter a date and time.");
  const [, year, month, day, hour, minute] = match.map(Number) as number[];
  const guess = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  return new Date(guess - zoneOffset(guess - zoneOffset(guess))).toISOString();
}

/** An ISO instant as a datetime-local value in college time. */
export function isoToCollegeTime(iso: string): string {
  const instant = Date.parse(iso);
  return new Date(instant + zoneOffset(instant)).toISOString().slice(0, 16);
}

/** Marks without trailing zeros: 10, 7.5, 2.25. */
export function formatScoreText(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/** A task is overdue when it is not done and its due time has passed. */
export function isOverdue(dueAt: string | null, done: boolean): boolean {
  return !done && dueAt !== null && Date.parse(dueAt) < Date.now();
}
