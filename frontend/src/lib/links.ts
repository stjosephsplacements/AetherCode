/**
 * A link into a page that belongs to one college. In a root administrator's
 * all-colleges list each row names its college, and the link points the console
 * there first; elsewhere it is the plain path.
 */
export function collegeHref(path: string, collegeId?: string): string {
  return collegeId ? `/staff/switch?college=${encodeURIComponent(collegeId)}&next=${encodeURIComponent(path)}` : path;
}
