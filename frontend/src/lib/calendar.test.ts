import { describe, expect, it } from "vitest";
import { daysOfWindow, monthGrid, overlappingPairs, parseMonth, shiftMonth, sharedWindow } from "./calendar";

describe("calendar", () => {
  it("lays a month out in Monday-first weeks", () => {
    const weeks = monthGrid("2026-10");
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0]![0]!.key).toBe("2026-09-28");
    expect(weeks[0]![3]).toEqual({ key: "2026-10-01", inMonth: true });
    expect(weeks.at(-1)!.at(-1)!.key).toBe("2026-11-01");
    expect(weeks.flat().filter((day) => day.inMonth)).toHaveLength(31);
  });

  it("moves between months across a year", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("accepts only real months", () => {
    expect(parseMonth("2026-10")).toBe("2026-10");
    expect(parseMonth("2026-13")).toBeNull();
    expect(parseMonth(undefined)).toBeNull();
  });

  it("lists each college day a window touches", () => {
    // 21:00 UTC on the 20th is 02:30 IST on the 21st.
    expect(daysOfWindow("2026-10-20T21:00:00Z", "2026-10-22T05:00:00Z")).toEqual(["2026-10-21", "2026-10-22"]);
  });
});

describe("overlaps", () => {
  const window = (id: string, opensAt: string, closesAt: string) => ({ id, opensAt, closesAt });
  const a = window("a", "2026-11-02T09:00:00Z", "2026-11-02T12:00:00Z");
  const b = window("b", "2026-11-02T11:00:00Z", "2026-11-02T14:00:00Z");
  const c = window("c", "2026-11-02T12:00:00Z", "2026-11-02T13:00:00Z");
  const far = window("far", "2026-11-09T09:00:00Z", "2026-11-09T10:00:00Z");

  it("pairs windows that share time, in any input order", () => {
    const ids = overlappingPairs([far, b, a, c]).map(([first, second]) => `${first.id}${second.id}`);
    expect(ids).toEqual(["ab", "bc"]);
  });

  it("treats a window that opens as another closes as no clash", () => {
    expect(overlappingPairs([a, window("next", "2026-11-02T12:00:00Z", "2026-11-02T15:00:00Z")]).map(([x, y]) => `${x.id}${y.id}`)).toEqual([]);
  });

  it("reports the shared stretch", () => {
    expect(sharedWindow(a, b)).toEqual({ opensAt: "2026-11-02T11:00:00Z", closesAt: "2026-11-02T12:00:00Z" });
  });
});
