import type { RoleName } from "@/lib/api-types";

/** Gold roles span colleges, Silver belong to one college, Bronze to a batch or to the person (docs/PLAN.md section 4). */
export type Tier = "gold" | "silver" | "bronze";

export const ROLE_TIER: Record<RoleName, Tier> = {
  super_admin: "gold",
  placement_user: "gold",
  college_admin: "silver",
  department_user: "silver",
  mentor: "bronze",
  student: "bronze",
};

/** How a role reads in a sentence: "Good morning, Sam. Faculty." */
export const ROLE_NAMES: Record<RoleName, string> = {
  super_admin: "Platform administrator",
  college_admin: "College administrator",
  department_user: "Faculty",
  mentor: "Mentor",
  placement_user: "Placement staff",
  student: "Student",
};

/** Short labels for lists and chips. */
export const ROLE_SHORT: Record<RoleName, string> = {
  super_admin: "Super admin",
  college_admin: "College admin",
  department_user: "Department",
  mentor: "Mentor",
  placement_user: "Placement",
  student: "Student",
};

/** Roles a college or the platform hands to staff (everyone but the platform administrator and students). */
export const STAFF_ROLES = new Set<string>(["college_admin", "department_user", "mentor", "placement_user"]);
