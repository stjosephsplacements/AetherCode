import { describe, expect, it } from "vitest";
import type { RoleName } from "@/lib/api-types";
import { type Viewer, homeFor, isPlacementOnly } from "./viewer";

const viewer = (...roles: RoleName[]): Viewer => ({ principalId: "p", displayName: "P", username: "p", tenantId: null, roles });

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
