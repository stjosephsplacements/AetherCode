import { describe, expect, it } from "vitest";
import { appendPage, pageExhausted, SNAPSHOT_PAGE_SIZE } from "./snapshot-pages";

describe("snapshot-pages", () => {
  it("treats a short fetch as exhausted", () => {
    expect(pageExhausted(0, SNAPSHOT_PAGE_SIZE)).toBe(true);
    expect(pageExhausted(SNAPSHOT_PAGE_SIZE - 1, SNAPSHOT_PAGE_SIZE)).toBe(true);
    expect(pageExhausted(SNAPSHOT_PAGE_SIZE, SNAPSHOT_PAGE_SIZE)).toBe(false);
  });

  it("appends the next page and marks exhaustion from that page alone", () => {
    expect(appendPage(["a"], ["b", "c"], 3)).toEqual({ items: ["a", "b", "c"], exhausted: true });
    expect(appendPage(["a"], ["b", "c", "d"], 3)).toEqual({
      items: ["a", "b", "c", "d"],
      exhausted: false,
    });
  });
});
