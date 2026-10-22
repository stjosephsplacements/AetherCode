import type { Me, Principal, RoleName } from "@/lib/api-types";

/** Who is signed in, as the UI needs it. Services re-check every permission. */
export type Viewer = {
  principalId: string;
  displayName: string;
  username: string;
  /** The college the viewer acts in; null for platform-wide staff. */
  tenantId: string | null;
  roles: RoleName[];
};

export function buildViewer(me: Me, principal: Principal): Viewer {
  const tenantId = me.student?.tenant_id ?? me.roles.find((role) => role.tenant_id)?.tenant_id ?? null;
  return {
    principalId: me.principal_id,
    displayName: principal.display_name || principal.username || "",
    username: principal.username ?? principal.email ?? "",
    tenantId,
    roles: [...new Set(me.roles.map((role) => role.role_name))],
  };
}

export function isStudent(viewer: Viewer): boolean {
  return viewer.roles.includes("student");
}

export function isStaff(viewer: Viewer): boolean {
  return viewer.roles.some((role) => role !== "student");
}

/**
 * Where a viewer lands after signing in, and when they open "/". Staff land
 * on /staff; a student who also holds a staff role can still open /student.
 * An account whose roles have not arrived yet is treated as a student: that
 * area shows only what the services allow, which is nothing until they do.
 */
export function homeFor(viewer: Viewer): "/student" | "/staff" {
  return isStaff(viewer) ? "/staff" : "/student";
}

/** A post-login destination from ?next=, accepted only as a same-site path. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}
