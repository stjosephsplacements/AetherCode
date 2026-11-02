export type CandidateRow = {
  id: string;
  roll: string;
  name: string;
  status: string;
  college: string;
  batchId: string;
  batch: string;
  departmentId: string;
  department: string;
  /** The placement department the student is assigned to; empty when none yet. */
  placementId: string;
};

export type Track = { id: string; label: string };
export type OrgRow = { id: string; name: string; code: string; status: string; tracks: Track[] };

/** A percentage of a whole, 0 when there is no whole. */
export const percent = (part: number, whole: number): number => (whole === 0 ? 0 : Math.round((part / whole) * 100));

export type DepartmentStat = { id: string; label: string; total: number; assigned: number; pending: number; percent: number };

/** Per college department: how many students there are and how many already have a placement department. */
export function departmentStats(rows: CandidateRow[]): DepartmentStat[] {
  const found = new Map<string, DepartmentStat>();
  for (const row of rows) {
    const key = row.departmentId || "none";
    const stat = found.get(key) ?? { id: key, label: row.department || "No department", total: 0, assigned: 0, pending: 0, percent: 0 };
    stat.total += 1;
    if (row.placementId) stat.assigned += 1;
    else stat.pending += 1;
    found.set(key, stat);
  }
  return [...found.values()].map((stat) => ({ ...stat, percent: percent(stat.assigned, stat.total) }));
}

export type DepartmentSort = "label" | "total" | "assigned" | "pending" | "percent";

/** Largest first for the numbers, A to Z for the name; ties fall back to the name. */
export function sortDepartments(stats: DepartmentStat[], by: DepartmentSort, descending: boolean): DepartmentStat[] {
  const name = (a: DepartmentStat, b: DepartmentStat) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
  const direction = descending ? -1 : 1;
  return [...stats].sort((a, b) => (by === "label" ? direction * name(a, b) : direction * (a[by] - b[by]) || name(a, b)));
}

export type OrgStat = { org: OrgRow; assigned: number; perTrack: { track: Track; assigned: number }[] };

/** How many of the students in view sit in each organisation, and in each of its tracks. */
export function orgStats(rows: CandidateRow[], orgs: OrgRow[]): OrgStat[] {
  const perPlacement = new Map<string, number>();
  for (const row of rows) if (row.placementId) perPlacement.set(row.placementId, (perPlacement.get(row.placementId) ?? 0) + 1);
  return orgs.map((org) => {
    const perTrack = org.tracks.map((track) => ({ track, assigned: perPlacement.get(track.id) ?? 0 }));
    return { org, assigned: perTrack.reduce((sum, entry) => sum + entry.assigned, 0), perTrack };
  });
}

/** Up to two letters for a lettermark: the first letters of the first two words. */
export function lettermark(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}
