import { describe, expect, it } from "vitest";
import { type Attempt, type ExamPoint, histogram, latestChange, mean, percent, shareOf, spread, summarize } from "./analytics";

const attempt = (candidate: string, share: number, exam = "e1"): Attempt => ({ exam, candidate, share });

describe("summarize", () => {
  it("averages shares and counts distinct students and passes", () => {
    const result = summarize([attempt("a", 0.8), attempt("a", 0.2, "e2"), attempt("b", 0.4)]);
    expect(result.attempts).toBe(3);
    expect(result.students).toBe(2);
    expect(result.average).toBeCloseTo((0.8 + 0.2 + 0.4) / 3);
    expect(result.pass).toBeCloseTo(2 / 3);
  });

  it("is zero, not NaN, with nothing graded", () => {
    expect(summarize([])).toEqual({ attempts: 0, students: 0, average: 0, pass: 0 });
    expect(mean([])).toBe(0);
  });
});

describe("shareOf", () => {
  it("is the score over the marks, and null when there are no marks", () => {
    expect(shareOf("15", "20")).toBe(0.75);
    expect(shareOf("0", "0")).toBeNull();
  });
});

describe("histogram", () => {
  it("puts scores in tenths, with a perfect score in the last band", () => {
    const counts = histogram([0, 0.05, 0.1, 0.55, 0.99, 1]).map((bucket) => bucket.count);
    expect(counts).toEqual([2, 1, 0, 0, 0, 1, 0, 0, 0, 2]);
  });

  it("keeps every score even when one is out of range", () => {
    const total = histogram([-0.2, 1.4, 0.5]).reduce((sum, bucket) => sum + bucket.count, 0);
    expect(total).toBe(3);
  });
});

describe("latestChange", () => {
  const point = (id: string, at: string, average: number): ExamPoint => ({ id, title: id, at, graded: 10, average, pass: 0.5, highest: 1, lowest: 0 });

  it("compares the newest exam with the one before it, whatever order they arrive in", () => {
    expect(latestChange([point("b", "2026-02-01", 0.7), point("a", "2026-01-01", 0.6)])).toBeCloseTo(10);
    expect(latestChange([point("a", "2026-01-01", 0.6), point("b", "2026-02-01", 0.5)])).toBeCloseTo(-10);
  });

  it("is null until there are two exams", () => {
    expect(latestChange([point("a", "2026-01-01", 0.6)])).toBeNull();
  });
});

describe("percent", () => {
  it("rounds to a whole number", () => {
    expect(percent(0.456)).toBe("46%");
  });
});

describe("spread", () => {
  it("finds the middle, the extremes and the number under the pass mark", () => {
    expect(spread([0.9, 0.1, 0.5, 0.3])).toEqual({ median: 0.4, highest: 0.9, lowest: 0.1, below: 2 });
    expect(spread([0.7, 0.2, 0.9])).toEqual({ median: 0.7, highest: 0.9, lowest: 0.2, below: 1 });
  });

  it("is null with nothing to measure", () => {
    expect(spread([])).toBeNull();
  });
});
