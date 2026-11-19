import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { collegeHref } from "@/lib/links";
import { CollegeLink } from "./college-link";

// Mark Next's Link so a test can tell which branch rendered.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) => createElement("a", { href, "data-next-link": "true" }, children as string),
}));

describe("CollegeLink", () => {
  it("renders the open-college route as a plain anchor without Link-only props", () => {
    const href = collegeHref("/staff/exams/abc/results", "11111111-1111-1111-1111-111111111111");
    const html = renderToStaticMarkup(createElement(CollegeLink, { href, prefetch: true, scroll: false, className: "x" }, "Open"));
    expect(html).toBe(`<a href="${href.replaceAll("&", "&amp;")}" class="x">Open</a>`);
    expect(html).not.toContain("data-next-link");
  });

  it("keeps client navigation for every other path", () => {
    const html = renderToStaticMarkup(createElement(CollegeLink, { href: collegeHref("/staff/exams/abc") }, "Exam"));
    expect(html).toContain('href="/staff/exams/abc"');
    expect(html).toContain('data-next-link="true"');
  });

  it("builds the open-college href with the college and the encoded next path", () => {
    expect(collegeHref("/staff/x?a=b", "c-1")).toBe("/admin/open?college=c-1&next=%2Fstaff%2Fx%3Fa%3Db");
    expect(collegeHref("/staff/x")).toBe("/staff/x");
  });
});
