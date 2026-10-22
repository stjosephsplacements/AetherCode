import "server-only";
import type { Page, Student } from "@/lib/api-types";
import { gateway } from "./gateway";

/** Every student of a college, following the cursor (up to 5000). */
export async function listAllStudents(tenantId: string): Promise<Student[]> {
  const students: Student[] = [];
  let cursor = "";
  for (let page = 0; page < 50; page++) {
    const result = await gateway<Page<Student>>(`/user/v1/tenants/${tenantId}/students?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    students.push(...result.items);
    if (!result.next_cursor) break;
    cursor = result.next_cursor;
  }
  return students;
}
