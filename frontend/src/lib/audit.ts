import type { AuditEntry } from "@/lib/api-types";

/** What a write on each resource means, in staff terms (ADR-0043). */
const ACTIONS: Record<string, string> = {
  "submission/attempt_events": "Gave extra time or posted an announcement",
  "submission/score_summaries": "Released results, regraded, or changed exam integrity",
  "submission/attempts": "Changed a student's attempt",
  "assessment/exams": "Created or duplicated an exam",
  "assessment/exam_versions": "Edited or published an exam",
  "assessment/exam_sections": "Edited an exam's sections or pools",
  "assessment/exam_items": "Edited an exam's questions or repinned one",
  "assessment/assignment_rules": "Assigned an exam or moved its window",
  "assessment/proctor_policies": "Changed a lockdown policy",
  "assessment/proctor_policy_versions": "Changed a lockdown policy",
  "question-bank/questions": "Created, archived or moved a question between tests and practice",
  "question-bank/question_versions": "Edited, checked or published a question",
  "question-bank/test_case_manifests": "Changed a question's tests",
  "question-bank/question_exports": "Exported a question with its hidden tests",
  "question-bank/question_version_tags": "Changed a question's tags",
  "question-bank/question_assets": "Added a file to a question",
  "user/accounts": "Imported students, reset a password, or turned sign-in on or off",
  "user/students": "Changed a student's record",
  "user/role_assignments": "Gave or removed a staff role",
  "user/mentor_batch_assignments": "Assigned a mentor to a batch",
  "user/student_batch_affiliations": "Moved a student between batches",
  "tenant/departments": "Changed a department",
  "tenant/batches": "Created or changed a batch",
  "seb/configurations": "Changed Safe Exam Browser settings",
  "seb/key_rotations": "Rotated a Safe Exam Browser key",
};

/** Resource names are plural table names: batches, departments, categories. */
const singular = (name: string) => name.replace(/ies$/, "y").replace(/(ch|sh|x|ss)es$/, "$1").replace(/s$/, "");

/** A staff change in words: the known resource, or a plain fallback. */
export function auditAction(entry: Pick<AuditEntry, "service" | "resource_type"> & { action?: AuditEntry["action"] }): string {
  if (entry.action === "delete") return `Deleted ${singular(entry.resource_type.replaceAll("_", " "))} (${entry.service})`;
  return ACTIONS[`${entry.service}/${entry.resource_type}`] ?? `Changed ${entry.resource_type.replaceAll("_", " ")} (${entry.service})`;
}
