import { PASS_SHARE } from "@/lib/results";

/** One graded attempt, as a share of the marks (0 to 1). */
export type Attempt = { exam: string; candidate: string; share: number };

export type Summary = { attempts: number; students: number; average: number; pass: number };

export const mean = (values: number[]): number => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

export function summarize(attempts: Attempt[]): Summary {
  return {
    attempts: attempts.length,
    students: new Set(attempts.map((attempt) => attempt.candidate)).size,
    average: mean(attempts.map((attempt) => attempt.share)),
    pass: attempts.filter((attempt) => attempt.share >= PASS_SHARE).length / Math.max(attempts.length, 1),
  };
}

/** A graded score as a share of its marks, or null when the exam carries no marks. */
export function shareOf(score: string, maximum: string): number | null {
  const max = Number(maximum);
  return max > 0 ? Number(score) / max : null;
}

export type Bucket = { from: number; to: number; count: number };

/** Counts of scores in equal-width bands from 0 to 100%; a perfect score lands in the last band. */
export function histogram(shares: number[], bands = 10): Bucket[] {
  const buckets = Array.from({ length: bands }, (_, index) => ({ from: index / bands, to: (index + 1) / bands, count: 0 }));
  for (const share of shares) {
    const index = Math.min(bands - 1, Math.max(0, Math.floor(share * bands)));
    buckets[index]!.count += 1;
  }
  return buckets;
}

export type ExamPoint = { id: string; title: string; at: string; graded: number; average: number; pass: number; highest: number; lowest: number; college?: { id: string; name: string } };

/** Change in the average from the previous exam to the latest, in points of the marks. Null with fewer than two exams. */
export function latestChange(points: ExamPoint[]): number | null {
  if (points.length < 2) return null;
  const ordered = [...points].sort((a, b) => a.at.localeCompare(b.at));
  return (ordered.at(-1)!.average - ordered.at(-2)!.average) * 100;
}

export type Spread = { median: number; highest: number; lowest: number; below: number };

/** The middle, the extremes and how many fell under the pass mark; null with no scores. */
export function spread(shares: number[]): Spread | null {
  if (shares.length === 0) return null;
  const sorted = [...shares].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    median: sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2,
    highest: sorted.at(-1)!,
    lowest: sorted[0]!,
    below: sorted.filter((share) => !passes(share)).length,
  };
}

/** Whether an average clears the pass mark. */
export const passes = (share: number) => share >= PASS_SHARE;

export const percent = (share: number) => `${Math.round(share * 100)}%`;
