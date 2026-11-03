import "server-only";
import { cache } from "react";
import type { Page } from "@/lib/api-types";
import { listBatches, listDepartments, listPlacement } from "./directory";
import { gateway } from "./gateway";
import type { StaffContext } from "./staff";

export type SetupKey = "college" | "department" | "batch" | "placement" | "students" | "questions" | "exam";
export type SetupStep = { key: SetupKey; title: string; text: string; href: string; done: boolean; /** Why it cannot be started yet. */ blocked?: string };

const count = async (path: string) => {
  try {
    return (await gateway<Page<unknown>>(path)).items.length > 0;
  } catch {
    return true; // unknown is not "empty": never lock a page because a service is down
  }
};

/** The order things must be created in: each step needs the one before it. Cached per request. */
export const setupSteps = cache(async (staff: StaffContext): Promise<SetupStep[]> => {
  const id = staff.tenantId;
  const college = Boolean(id);
  const [departments, batches, placement, students, questions, exams] = id
    ? await Promise.all([
        listDepartments(id).then((r) => r.length > 0, () => true),
        listBatches(id).then((r) => r.length > 0, () => true),
        listPlacement().then((r) => !r.readable || r.organizations.some((o) => o.departments.length > 0), () => true),
        count(`/user/v1/tenants/${id}/students/roster?limit=1`),
        count("/question-bank/v1/questions?limit=1"),
        count(`/assessment/v1/tenants/${id}/exams?limit=1`),
      ])
    : [false, false, false, false, false, false];
  const steps: SetupStep[] = [
    { key: "college", title: "Create a college", text: "Every department, student and exam belongs to a college.", href: "/admin/colleges", done: college },
    { key: "department", title: "Add a department", text: "Departments group the batches and staff of a college.", href: "/staff/departments", done: departments },
    { key: "batch", title: "Add a batch", text: "A batch is a year of a department. Students are enrolled into one.", href: "/staff/departments", done: batches },
    { key: "placement", title: "Add a placement department", text: "Every student is enrolled under one. Add the hiring organisation, then its department.", href: "/staff/placements", done: placement },
    { key: "students", title: "Enrol students", text: "Add them one by one or import a spreadsheet.", href: "/staff/students", done: students },
    { key: "questions", title: "Write questions", text: "Build the question bank that exams draw from.", href: "/staff/questions", done: questions },
    { key: "exam", title: "Schedule an exam", text: "Pick questions, a batch and a time window.", href: "/staff/exams", done: exams },
  ];
  // A step is blocked while any earlier step it depends on is not done. Questions only need a college.
  const needs: Record<SetupKey, SetupKey[]> = { college: [], department: ["college"], batch: ["department"], placement: ["college"], students: ["batch", "placement"], questions: ["college"], exam: ["questions", "batch"] };
  const done = new Set(steps.filter((s) => s.done).map((s) => s.key));
  const label = new Map(steps.map((s) => [s.key, s.title.toLowerCase()]));
  for (const step of steps) {
    const missing = needs[step.key].find((key) => !done.has(key));
    if (missing) step.blocked = `First ${label.get(missing)}.`;
  }
  return steps;
});

/** Which sidebar pages to lock, and why. */
export function lockedPages(steps: SetupStep[]): Record<string, string> {
  const by = new Map(steps.map((s) => [s.key, s]));
  const locks: Record<string, string> = {};
  const lock = (href: string, key: SetupKey) => {
    const reason = by.get(key)?.blocked;
    if (reason) locks[href] = reason;
  };
  lock("/staff/departments", "department");
  lock("/staff/accounts", "department");
  lock("/staff/students", "students");
  lock("/staff/placements", "placement");
  lock("/staff/questions", "questions");
  lock("/staff/exams", "exam");
  return locks;
}
