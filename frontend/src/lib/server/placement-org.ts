import "server-only";
import type { Department } from "@/lib/api-types";
import { departmentLabel, type PlacementDirectory } from "./directory";

/** The one placement organisation this deployment uses. Departments hang off it for every college. */
export function primaryPlacementOrganization(directory: PlacementDirectory) {
  return directory.organizations[0] ?? null;
}

/**
 * Global tracks for pickers and labels (ADR-0080). Departments from every listed
 * organisation are included so legacy rows still resolve; labels never name the org.
 */
export function placementDepartmentOptions(directory: PlacementDirectory): { id: string; label: string }[] {
  return directory.organizations.flatMap((organization) =>
    organization.departments.map((department: Department) => ({ id: department.id, label: departmentLabel(department) })),
  );
}
