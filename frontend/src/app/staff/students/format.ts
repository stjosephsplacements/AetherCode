/** Two letters for an avatar: the first and last word of the name, else the start of the roll number. */
export function initials(name: string, roll: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return roll.slice(0, 2).toUpperCase();
  const letters = words.length === 1 ? words[0]!.slice(0, 2) : `${words[0]![0]}${words[words.length - 1]![0]}`;
  return letters.toUpperCase();
}

/** An Indian mobile number as "+91 98765 43210"; anything else is shown as typed. */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 10 ? digits : "";
  if (!local) return phone;
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
}

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"} ago`;

/** "just now", "5 minutes ago", "3 days ago"; a date once it is a month old. */
export function relativeTime(iso: string, now: number): string {
  const age = now - new Date(iso).getTime();
  if (Number.isNaN(age)) return "";
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return plural(days, "day");
  if (days < 30) return plural(Math.floor(days / 7), "week");
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export const MAX_IMPORT_ROWS = 500;

/** The sample file offered for download: a header row and rows that follow every rule. */
export const IMPORT_TEMPLATE = ["roll_number,name,email", "21CS001,Asha Raman,asha.raman@example.edu", "21CS002,Vikram Iyer,", "21CS003,Meera Nair,meera.nair@example.edu"].join("\n") + "\n";

export type ImportLine = { line: number; roll: string; name: string; email: string; problem: string | null };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Reads "roll number, name[, email]" lines the way the server does (a header row is skipped, cells split on commas)
 * and says what is wrong with each, so the author fixes it before anything is sent.
 */
export function parseImport(text: string): ImportLine[] {
  const seen = new Set<string>();
  const lines: ImportLine[] = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const cells = trimmed.split(",").map((cell) => cell.trim().replace(/^"(.*)"$/, "$1"));
    if (index === 0 && /roll/i.test(cells[0] ?? "")) continue;
    const [roll = "", name = "", email = ""] = cells;
    let problem: string | null = null;
    if (!roll) problem = "Missing roll number";
    else if (/\s/.test(roll) || roll.length > 40) problem = "Roll number has spaces or is over 40 characters";
    else if (!name) problem = "Missing name";
    else if (name.length > 120) problem = "Name is over 120 characters";
    else if (cells.length > 3) problem = "Too many columns: names cannot contain commas";
    else if (email && !EMAIL.test(email)) problem = "Email is not valid";
    else if (seen.has(roll.toLowerCase())) problem = "Roll number appears twice";
    if (roll) seen.add(roll.toLowerCase());
    lines.push({ line: index + 1, roll, name, email, problem });
  }
  return lines;
}

/** The text the import action takes: only the lines with no problem. */
export const importText = (lines: ImportLine[]): string =>
  lines.filter((entry) => !entry.problem).map((entry) => [entry.roll, entry.name, entry.email].join(",").replace(/,$/, "")).join("\n");
