import { describe, expect, it } from "vitest";
import type { NavItem } from "@/components/nav-links";
import { isNavActive, isNavBranch, navTrail } from "./staff-nav";

const tree: NavItem[] = [
  {
    href: "/staff/departments",
    label: "Departments",
    icon: "organisation",
    children: [{ href: "/staff/departments/batches", label: "Batches", icon: "batch" }],
  },
  {
    href: "/staff/accounts",
    label: "Staff accounts",
    icon: "accounts",
    children: [
      { href: "/staff/roles", label: "Roles", icon: "roles" },
      { href: "/staff/permissions", label: "Permissions", icon: "accounts" },
    ],
  },
  { href: "/staff/students", label: "Students", icon: "students" },
  {
    href: "/staff/exams",
    label: "Exams",
    icon: "exams",
    children: [
      { href: "/staff/proctor-policies", label: "Proctor policies", icon: "roles" },
      { href: "/staff/calendar", label: "Calendar", icon: "calendar" },
    ],
  },
];

describe("staff nav tree", () => {
  it("marks a parent active when a non-prefix child matches", () => {
    expect(isNavActive("/staff/roles", "/staff/accounts")).toBe(false);
    expect(isNavBranch("/staff/roles", tree[1]!)).toBe(true);
    expect(isNavBranch("/staff/calendar", tree[3]!)).toBe(true);
  });

  it("builds the nav trail for nested leaves", () => {
    expect(navTrail(tree, "/staff/roles")?.map((item) => item.label)).toEqual(["Staff accounts", "Roles"]);
    expect(navTrail(tree, "/staff/students")?.map((item) => item.label)).toEqual(["Students"]);
    expect(navTrail(tree, "/staff/proctor-policies/abc")?.map((item) => item.label)).toEqual(["Exams", "Proctor policies"]);
  });

  it("keeps path-prefix children working", () => {
    expect(navTrail(tree, "/staff/departments/batches")?.map((item) => item.label)).toEqual(["Departments", "Batches"]);
    expect(isNavBranch("/staff/exams/xyz", tree[3]!)).toBe(true);
  });
});
