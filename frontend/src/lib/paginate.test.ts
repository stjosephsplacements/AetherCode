import { describe, expect, it } from "vitest";
import { paginate } from "./paginate";

const items = Array.from({ length: 60 }, (_, i) => i);

describe("paginate", () => {
  it("returns the first page by default", () => {
    const p = paginate(items, undefined, 25);
    expect(p).toMatchObject({ page: 1, pages: 3, total: 60, from: 1, to: 25 });
    expect(p.rows[0]).toBe(0);
  });
  it("returns a short last page", () => {
    const p = paginate(items, "3", 25);
    expect(p.rows).toHaveLength(10);
    expect(p).toMatchObject({ from: 51, to: 60 });
  });
  it("clamps junk and out of range pages", () => {
    expect(paginate(items, "abc", 25).page).toBe(1);
    expect(paginate(items, "-4", 25).page).toBe(1);
    expect(paginate(items, "99", 25).page).toBe(3);
  });
  it("handles an empty list", () => {
    expect(paginate([], "1")).toMatchObject({ pages: 1, from: 0, to: 0, rows: [] });
  });
});
