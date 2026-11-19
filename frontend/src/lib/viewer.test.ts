import { describe, expect, it } from "vitest";
import type { RoleName } from "@/lib/api-types";
import { type Viewer, canViewStudentPII, homeFor, isPlacementOnly, reachesAllColleges } from "./viewer";

const viewer = (...roles: RoleName[]): Viewer => ({
  principalId: "p",
  displayName: "P",
  username: "p",
  tenantId: null,
  roles,
  placementDepartmentIds: [],
  permissions: [],
});

describe("reachesAllColleges", () => {
  const officer = (platformRoles?: RoleName[]): Viewer => ({ ...viewer("placement_user"), tenantId: "t", platformRoles });
  it("covers platform administrators and platform-scoped officers only", () => {
    expect(reachesAllColleges({ ...officer(), roles: ["super_admin"] })).toBe(true);
    expect(reachesAllColleges(officer(["placement_user"]))).toBe(true);
    expect(reachesAllColleges(officer([]))).toBe(false);
    expect(reachesAllColleges(officer())).toBe(false);
  });
});

describe("canViewStudentPII", () => {
  it("follows VIEW_STUDENT_PII and ADMINISTRATOR flags", () => {
    expect(canViewStudentPII(viewer("placement_user"))).toBe(false);
    expect(canViewStudentPII({ ...viewer("placement_user"), permissions: ["VIEW_STUDENT_PII"] })).toBe(true);
    expect(canViewStudentPII({ ...viewer("super_admin"), permissions: ["ADMINISTRATOR"] })).toBe(true);
  });
});

describe("homeFor", () => {
  it("sends each kind of account to its own area", () => {
    expect(homeFor(viewer("super_admin"))).toBe("/admin");
    expect(homeFor(viewer("college_admin"))).toBe("/staff");
    expect(homeFor(viewer("department_user", "mentor"))).toBe("/staff");
    expect(homeFor(viewer("placement_user"))).toBe("/placement");
    expect(homeFor(viewer("student"))).toBe("/student");
    expect(homeFor(viewer())).toBe("/student");
  });

  it("keeps placement staff who also hold a college role in /staff", () => {
    expect(isPlacementOnly(viewer("placement_user"))).toBe(true);
    expect(isPlacementOnly(viewer("placement_user", "student"))).toBe(true);
    expect(isPlacementOnly(viewer("placement_user", "college_admin"))).toBe(false);
    expect(homeFor(viewer("placement_user", "college_admin"))).toBe("/staff");
  });
});