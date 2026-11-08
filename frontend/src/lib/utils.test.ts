import { describe, expect, test } from "vitest";
import { collegeTimeToISO, editorLanguage, formatDuration, formatScoreText, isoToCollegeTime, isOverdue, languageName } from "./utils";

describe("formatDuration", () => {
  test("minutes only", () => expect(formatDuration(300)).toBe("5 min"));
  test("hours only", () => expect(formatDuration(7200)).toBe("2 h"));
  test("hours and minutes", () => expect(formatDuration(5400)).toBe("1 h 30 min"));
  test("zero seconds", () => expect(formatDuration(0)).toBe("0 min"));
});

describe("formatScoreText", () => {
  test("integer", () => expect(formatScoreText(10)).toBe("10"));
  test("one decimal", () => expect(formatScoreText(7.5)).toBe("7.5"));
  test("two decimals", () => expect(formatScoreText(2.25)).toBe("2.25"));
  test("trailing zeros stripped", () => expect(formatScoreText(3.1)).toBe("3.1"));
  test("small value", () => expect(formatScoreText(0.5)).toBe("0.5"));
});

describe("languageName", () => {
  test("known key", () => expect(languageName("python3")).toBe("Python 3"));
  test("unknown key passes through", () => expect(languageName("brainfuck")).toBe("brainfuck"));
});

describe("editorLanguage", () => {
  test("cpp17 → cpp", () => expect(editorLanguage("cpp17")).toBe("cpp"));
  test("python3 → python", () => expect(editorLanguage("python3")).toBe("python"));
  test("java → java", () => expect(editorLanguage("java")).toBe("java"));
});

describe("collegeTimeToISO ↔ isoToCollegeTime", () => {
  test("round-trips a datetime-local value", () => {
    const local = "2026-10-21T10:00";
    const iso = collegeTimeToISO(local);
    expect(isoToCollegeTime(iso)).toBe(local);
  });
  test("rejects invalid input", () => {
    expect(() => collegeTimeToISO("bad")).toThrow("Enter a date and time.");
  });
});

describe("isOverdue", () => {
  test("not done, past due", () => expect(isOverdue("2020-01-01T00:00:00Z", false)).toBe(true));
  test("done, past due", () => expect(isOverdue("2020-01-01T00:00:00Z", true)).toBe(false));
  test("not done, future due", () => expect(isOverdue("2099-01-01T00:00:00Z", false)).toBe(false));
  test("null due date", () => expect(isOverdue(null, false)).toBe(false));
});
