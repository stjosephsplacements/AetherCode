import "server-only";
import type { CandidateAssignment, Page } from "@/lib/api-types";
import { gateway } from "./gateway";

/** The signed-in student's exam assignments, newest window first. */
export async function listAssignments(tenantId: string): Promise<CandidateAssignment[]> {
  const page = await gateway<Page<CandidateAssignment>>(`/assessment/v1/tenants/${tenantId}/candidate-assignments?limit=100`);
  return page.items;
}

export type AssignmentPhase = "live" | "upcoming" | "past";

/** Open now; upcoming, soonest first; and past. */
export function groupByPhase(assignments: CandidateAssignment[]): Record<AssignmentPhase, CandidateAssignment[]> {
  const now = Date.now();
  const groups: Record<AssignmentPhase, CandidateAssignment[]> = { live: [], upcoming: [], past: [] };
  for (const assignment of assignments) groups[phaseOf(assignment, now)].push(assignment);
  groups.upcoming.reverse();
  return groups;
}

/** The assignment Safe Exam Browser's start page for an exam should open: a current one if any. */
export function assignmentForExam(assignments: CandidateAssignment[], examId: string): CandidateAssignment | undefined {
  const now = Date.now();
  const matching = assignments.filter((assignment) => assignment.exam_id.toLowerCase() === examId.toLowerCase());
  return matching.find((assignment) => phaseOf(assignment, now) !== "past") ?? matching[0];
}

function phaseOf(assignment: CandidateAssignment, now: number): AssignmentPhase {
  const opens = Date.parse(assignment.available_from);
  const closes = Date.parse(assignment.available_until);
  const open = assignment.lifecycle_state === "assigned" || assignment.lifecycle_state === "started";
  if (open && opens <= now && now < closes) return "live";
  if (open && now < opens) return "upcoming";
  return "past";
}
