/**
 * The permission editor's rules, kept apart from the screen so they can be tested
 * (ADR-0055). A permission is "<service>.<resource>.<verb>"; write and delete
 * imply read, which the backend stores and the authorizer expands again.
 */

export type Verb = "read" | "write" | "delete";
export const VERBS: Verb[] = ["read", "write", "delete"];

export type CataloguePermission = { key: string; service: string; resource: string; verb: Verb; platform_only: boolean };

export type Resource = { id: string; label: string; area: string; platformOnly: boolean; verbs: Verb[] };

const AREAS: [string, string[]][] = [
  ["Questions", ["questions", "question_versions", "test_case_manifests", "question_assets", "tags", "question_version_tags", "categories", "practice_submissions"]],
  ["Exams", ["exams", "exam_versions", "exam_sections", "exam_items", "assignment_rules", "candidate_assignments", "proctor_policies", "proctor_policy_versions", "configurations"]],
  ["Results and analytics", ["attempts", "attempt_events", "score_summaries", "event_facts", "student_progress_rollups", "batch_progress_rollups", "exam_result_rollups", "placement_student_rollups", "report_exports"]],
  ["Students and staff", ["students", "student_department_memberships", "current_student_affiliations", "student_batch_affiliations", "mentor_batch_assignments", "placement_department_memberships", "staff_audit"]],
  ["Organisation", ["departments", "batches", "retention_policies", "legal_holds"]],
  ["Community", ["community", "community_moderation", "notifications"]],
  ["Platform", ["tenants", "placement_organizations", "provisioning_requests", "permission_grants", "role_assignments", "category_management", "question_exports"]],
];

const AREA_OF = new Map(AREAS.flatMap(([area, resources]) => resources.map((resource) => [resource, area] as const)));
export const AREA_ORDER = [...AREAS.map(([area]) => area), "Other"];

/** "exam_sections" becomes "Exam sections". */
export function resourceLabel(resource: string): string {
  const words = resource.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The catalogue as one row per resource, grouped by area for the pool. */
export function groupResources(catalogue: CataloguePermission[]): { area: string; resources: Resource[] }[] {
  const byResource = new Map<string, Resource>();
  for (const entry of catalogue) {
    const id = `${entry.service}.${entry.resource}`;
    const existing = byResource.get(id) ?? { id, label: resourceLabel(entry.resource), area: AREA_OF.get(entry.resource) ?? "Other", platformOnly: entry.platform_only, verbs: [] };
    existing.verbs.push(entry.verb);
    byResource.set(id, existing);
  }
  const resources = [...byResource.values()].map((resource) => ({ ...resource, verbs: VERBS.filter((verb) => resource.verbs.includes(verb)) }));
  return AREA_ORDER.map((area) => ({ area, resources: resources.filter((resource) => resource.area === area).sort((a, b) => a.label.localeCompare(b.label)) })).filter((group) => group.resources.length > 0);
}

const split = (permission: string): [string, Verb] => {
  const cut = permission.lastIndexOf(".");
  return [permission.slice(0, cut), permission.slice(cut + 1) as Verb];
};

/** The permissions plus the reads that write and delete imply. */
export function withImplied(permissions: Iterable<string>): Set<string> {
  const result = new Set<string>();
  for (const permission of permissions) {
    result.add(permission);
    const [resource, verb] = split(permission);
    if (verb === "write" || verb === "delete") result.add(`${resource}.read`);
  }
  return result;
}

/** A read that write or delete depends on cannot be taken out on its own. */
export function isLockedRead(permission: string, permissions: Set<string>): boolean {
  const [resource, verb] = split(permission);
  return verb === "read" && (permissions.has(`${resource}.write`) || permissions.has(`${resource}.delete`));
}

export function addPermission(permissions: Set<string>, permission: string): Set<string> {
  return withImplied([...permissions, permission]);
}

/** Removing write or delete leaves the read in place; removing a locked read does nothing. */
export function removePermission(permissions: Set<string>, permission: string): Set<string> {
  if (isLockedRead(permission, permissions)) return permissions;
  const next = new Set(permissions);
  next.delete(permission);
  return next;
}

/** Whether two sets differ, ignoring order. */
export function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((permission) => b.has(permission));
}
