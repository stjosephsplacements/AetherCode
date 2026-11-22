"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/staff/form";
import { actionError } from "@/lib/server/actions";
import { gateway } from "@/lib/server/gateway";
import { requirePlacement } from "@/lib/server/placement";

const refresh = () => {
  revalidatePath("/placement");
  revalidatePath("/placement/students");
  revalidatePath("/placement/analytics");
};

/** Map an existing college student into one of the officer's placement departments. */
export async function assignStudentPlacement(
  collegeId: string,
  studentId: string,
  placementDepartmentId: string,
): Promise<ActionState> {
  const placement = await requirePlacement();
  if (!placement.departmentIds.includes(placementDepartmentId)) {
    return { error: "That placement department is outside your assignment." };
  }
  if (!placement.colleges.some((college) => college.id === collegeId)) {
    return { error: "That college is outside your reach." };
  }
  try {
    await gateway(`/user/v1/tenants/${collegeId}/students/${studentId}/placement`, {
      method: "PUT",
      body: { placement_department_id: placementDepartmentId },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  refresh();
  return { error: null, message: "Student assigned to the track." };
}

/** Remove a student from their placement department (only if it is one you manage). */
export async function clearStudentPlacement(collegeId: string, studentId: string, currentPlacementId: string): Promise<ActionState> {
  const placement = await requirePlacement();
  if (!placement.departmentIds.includes(currentPlacementId)) {
    return { error: "That student is not on a track you manage." };
  }
  if (!placement.colleges.some((college) => college.id === collegeId)) {
    return { error: "That college is outside your reach." };
  }
  try {
    await gateway(`/user/v1/tenants/${collegeId}/students/${studentId}/placement`, {
      method: "PUT",
      body: { placement_department_id: "" },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  refresh();
  return { error: null, message: "Student removed from the track." };
}
