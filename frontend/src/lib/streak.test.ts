import { describe, expect, it } from "vitest";
import { currentStreak, weekGrid } from "./streak";

describe("currentStreak", () => {
  it("counts consecutive days ending today", () => {
    expect(currentStreak(["2026-11-02", "2026-11-01", "2026-10-31", "2026-10-29"], "2026-11-02")).toBe(3);
  });
  it("stays alive through yesterday", () => {
    expect(currentStreak(["2026-11-01", "2026-10-31"], "2026-11-02")).toBe(2);
  });
  it("is zero after a missed day", () => {
    expect(currentStreak(["2026-10-30"], "2026-11-02")).toBe(0);
    expect(currentStreak([], "2026-11-02")).toBe(0);
  });
  it("crosses month and year ends", () => {
    expect(currentStreak(["2027-01-01", "2026-12-31", "2026-12-30"], "2027-01-01")).toBe(3);
  });
});

describe("weekGrid", () => {
  it("has the asked weeks of 7 days, Monday first, ending in the current week", () => {
    const grid = weekGrid(["2026-11-02"], "2026-11-04", 4);
    expect(grid).toHaveLength(4);
    expect(grid.every((column) => column.length === 7)).toBe(true);
    const last = grid[3]!;
    expect(last[0]).toEqual({ day: "2026-11-02", active: true, future: false });
    expect(last[3]!.future).toBe(true);
  });
});
