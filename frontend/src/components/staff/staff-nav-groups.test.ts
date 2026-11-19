import { describe, expect, it } from "vitest";
import { collegeHref } from "@/lib/links";
import { staffNavGroups } from "./staff-nav-groups";

const hrefs = (groups: ReturnType<typeof staffNavGroups>) => groups.flatMap((group) => group.items.map((entry) => entry.href));

describe("staffNavGroups", () => {
  it("hides set-up and platform pages from staff who cannot manage accounts", () => {
    const groups = staffNavGroups({ canManageAccounts: false });
    expect(groups.map((group) => group.label)).toEqual(["Overview", "Assess", "Help"]);
    expect(hrefs(groups)).toEqual([
      "/staff",
      "/staff/get-started",
      "/staff/questions",
      "/staff/exams",
      "/staff/calendar",
      "/staff/analytics",
      "/staff/community",
      "/staff/help",
    ]);
  });

  it("lists every page for a college administrator, in creation order", () => {
    const groups = staffNavGroups({ canManageAccounts: true });
    expect(groups.map((group) => group.label)).toEqual(["Overview", "Set up", "Assess", "Platform", "Help"]);
    expect(hrefs(groups)).toEqual([
      "/staff",
      "/staff/get-started",
      "/staff/departments",
      "/staff/accounts",
      "/staff/students",
      "/staff/permissions",
      "/staff/roles",
      "/staff/questions",
      "/staff/exams",
      "/staff/calendar",
      "/staff/analytics",
      "/staff/community",
      "/staff/audit",
      "/staff/status",
      "/staff/help",
    ]);
  });

  it("applies locks by page, and routes links and labels for the admin sidebar", () => {
    const groups = staffNavGroups({ canManageAccounts: true, locks: { "/staff/exams": "Add a student first" }, link: (path) => collegeHref(path, "c1"), prefix: "College" });
    const exams = groups.flatMap((group) => group.items).find((entry) => entry.label === "Exams");
    expect(exams).toMatchObject({ href: "/admin/open?college=c1&next=%2Fstaff%2Fexams", locked: "Add a student first" });
    expect(groups[0]?.label).toBe("College · Overview");
  });
});
