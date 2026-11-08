import { describe, expect, test } from "vitest";
import { formatCountdown } from "./use-now";

describe("formatCountdown", () => {
  test("under a minute", () => expect(formatCountdown(45_000)).toBe("00:45"));
  test("exact minute", () => expect(formatCountdown(60_000)).toBe("01:00"));
  test("minutes and seconds", () => expect(formatCountdown(5 * 60_000 + 9_000)).toBe("05:09"));
  test("with hours", () => expect(formatCountdown(3661_000)).toBe("1:01:01"));
  test("zero", () => expect(formatCountdown(0)).toBe("00:00"));
  test("negative clamps to zero", () => expect(formatCountdown(-1000)).toBe("00:00"));
  test("sub-second rounds up", () => expect(formatCountdown(500)).toBe("00:01"));
});
