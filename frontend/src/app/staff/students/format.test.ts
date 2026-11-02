import { describe, expect, it } from "vitest";
import { formatPhone, importText, initials, parseImport, relativeTime } from "./format";

describe("initials", () => {
  it("uses first and last word, or the roll when unnamed", () => {
    expect(initials("Asha Raman", "21CS001")).toBe("AR");
    expect(initials("Asha Kumari Raman", "x")).toBe("AR");
    expect(initials("Asha", "x")).toBe("AS");
    expect(initials("", "21cs001")).toBe("21");
  });
});

describe("formatPhone", () => {
  it("groups an Indian mobile number and leaves others alone", () => {
    expect(formatPhone("9876543210")).toBe("+91 98765 43210");
    expect(formatPhone("+91 98765-43210")).toBe("+91 98765 43210");
    expect(formatPhone("12345")).toBe("12345");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it("counts up from just now to weeks", () => {
    expect(relativeTime(ago(10_000), now)).toBe("just now");
    expect(relativeTime(ago(60_000), now)).toBe("1 minute ago");
    expect(relativeTime(ago(5 * 3_600_000), now)).toBe("5 hours ago");
    expect(relativeTime(ago(3 * 86_400_000), now)).toBe("3 days ago");
    expect(relativeTime(ago(14 * 86_400_000), now)).toBe("2 weeks ago");
    expect(relativeTime(ago(90 * 86_400_000), now)).toMatch(/2026|Aug/);
    expect(relativeTime("nope", now)).toBe("");
  });
});

describe("parseImport", () => {
  it("skips a header, and names the problem on each bad line", () => {
    const lines = parseImport(["roll_number,name,email", "21CS001,Asha Raman,asha@example.edu", "21CS002,Vikram", "21CS001,Dup,", ",NoRoll", "21CS003,Bad Mail,nope", "21CS004,A,b@c.d,extra"].join("\n"));
    expect(lines.map((entry) => entry.problem)).toEqual([null, null, "Roll number appears twice", "Missing roll number", "Email is not valid", "Too many columns: names cannot contain commas"]);
    expect(lines[0]!.line).toBe(2);
  });

  it("sends only the good lines", () => {
    expect(importText(parseImport("a1,Asha,a@b.co\nb2,Vik\n,bad"))).toBe("a1,Asha,a@b.co\nb2,Vik");
  });
});
