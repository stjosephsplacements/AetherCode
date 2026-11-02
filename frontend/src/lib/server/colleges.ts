import "server-only";
import { mapLimit } from "./exams";
import type { CollegeRef } from "./staff";

export type PerCollege<T> = { college: CollegeRef; value: T | null; failed: boolean };

/**
 * Runs one loader in each college, a few at a time. A college that fails to answer
 * is reported as failed rather than taking the whole page down.
 */
export async function inColleges<T>(colleges: CollegeRef[], load: (collegeId: string) => Promise<T>): Promise<PerCollege<T>[]> {
  return mapLimit(colleges, 4, async (college) => {
    try {
      return { college, value: await load(college.id), failed: false };
    } catch (error) {
      console.error(`could not load ${college.name}:`, error);
      return { college, value: null, failed: true };
    }
  });
}
