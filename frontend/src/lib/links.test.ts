import { describe, expect, it } from "vitest";
import { collegeHref } from "./links";

describe("collegeHref", () => {
  it("is the plain path inside one college", () => {
    expect(collegeHref("/staff/exams/abc")).toBe("/staff/exams/abc");
  });

  it("goes through the switch for a row from another college", () => {
    expect(collegeHref("/staff/exams/abc/results", "college-1")).toBe("/staff/switch?college=college-1&next=%2Fstaff%2Fexams%2Fabc%2Fresults");
  });
});
