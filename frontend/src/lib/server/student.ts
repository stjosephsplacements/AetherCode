import "server-only";
import { redirect } from "next/navigation";
import type { Viewer } from "@/lib/viewer";
import { isStaff, isStudent } from "@/lib/viewer";
import { requireViewer } from "./session";

export type StudentContext = { viewer: Viewer; tenantId: string };

/** Signed-in student with a college, or a redirect away from student-only pages. */
export async function requireStudent(): Promise<StudentContext> {
  const viewer = await requireViewer();
  if (!isStudent(viewer) && isStaff(viewer)) redirect("/staff");
  if (!viewer.tenantId) redirect("/student");
  return { viewer, tenantId: viewer.tenantId };
}