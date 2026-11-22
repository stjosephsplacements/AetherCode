import type { Metadata } from "next";
import { EmptyState, LoadError, PageHeader, Table } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import { listPlacement } from "@/lib/server/directory";
import { inColleges } from "@/lib/server/colleges";
import { requirePlacement } from "@/lib/server/placement";
import { placementDepartmentOptions } from "@/lib/server/placement-org";
import { listRoster } from "@/lib/server/students";
import { assignStudentPlacement, clearStudentPlacement } from "./actions";
import { AssignControls, ClearControls } from "./assign-controls";

export const metadata: Metadata = { title: "Placement students" };

type Row = {
  id: string;
  collegeId: string;
  college: string;
  roll: string;
  name: string;
  placementId: string;
  placement: string;
};

/** Pick existing college students into an assigned track; never create accounts (ADR-0089). */
export default async function PlacementStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  const placement = await requirePlacement();
  const params = await searchParams;
  const query = (params.q ?? "").trim().toLowerCase();
  const filter = params.filter === "assigned" || params.filter === "pool" ? params.filter : "all";

  let rows: Row[] = [];
  let tracks: { id: string; label: string }[] = [];
  try {
    const directory = await listPlacement();
    const allTracks = placementDepartmentOptions(directory);
    tracks = allTracks.filter((track) => placement.departmentIds.includes(track.id));
    const trackName = new Map(allTracks.map((track) => [track.id, track.label] as const));
    const managed = new Set(placement.departmentIds);

    const perCollege = await inColleges(placement.colleges, async (collegeId) => listRoster(collegeId, []));
    rows = perCollege.flatMap(({ college, value }) => {
      if (!value) return [];
      return value
        .filter((student) => {
          const pid = student.placement_department_id ?? "";
          if (pid && !managed.has(pid)) return false;
          return true;
        })
        .map((student) => ({
          id: student.id,
          collegeId: college.id,
          college: college.name,
          roll: student.enrollment_number,
          name: student.profile_name ?? "",
          placementId: student.placement_department_id ?? "",
          placement: student.placement_department_id
            ? (trackName.get(student.placement_department_id) ?? "Track")
            : "Unassigned",
        }));
    });
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="Students" />
        <LoadError error={error} />
      </div>
    );
  }

  if (filter === "pool") rows = rows.filter((row) => !row.placementId);
  if (filter === "assigned") rows = rows.filter((row) => row.placementId);
  if (query) {
    rows = rows.filter(
      (row) =>
        row.roll.toLowerCase().includes(query) ||
        row.name.toLowerCase().includes(query) ||
        row.college.toLowerCase().includes(query),
    );
  }

  const several = placement.colleges.length > 1;

  return (
    <div className="animate-enter space-y-6">
      <PageHeader
        title="Students"
        description={
          tracks.length === 0
            ? "Ask a platform administrator to assign you a placement department before mapping students."
            : "Select students already enrolled in a college and map them into your track. You do not create accounts."
        }
      />

      {tracks.length === 0 ? (
        <EmptyState>No placement department is assigned to you yet.</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>
          {query || filter !== "all" ? "No students match these filters." : "No eligible students in the colleges you reach."}
        </EmptyState>
      ) : (
        <Table head={[...(placement.canViewPII ? ["Roll", "Name"] : ["Roll"]), ...(several ? ["College"] : []), "Track", ""]}>
          {rows.map((row) => (
            <tr key={`${row.collegeId}:${row.id}`}>
              {placement.canViewPII ? (
                <>
                  <td className="px-4 py-3 font-mono text-[13px] text-ink">{row.roll}</td>
                  <td className="px-4 py-3 font-medium text-ink">{row.name || "—"}</td>
                </>
              ) : (
                <td className="px-4 py-3 font-mono text-[13px] text-ink">{row.roll}</td>
              )}
              {several && <td className="px-4 py-3 text-ink-muted">{row.college}</td>}
              <td className="px-4 py-3">
                <Badge tone={row.placementId ? "success" : "neutral"}>{row.placement}</Badge>
              </td>
              <td className="px-4 py-2 text-right">
                {row.placementId ? (
                  <ClearControls
                    collegeId={row.collegeId}
                    studentId={row.id}
                    currentPlacementId={row.placementId}
                    action={clearStudentPlacement}
                  />
                ) : (
                  <AssignControls collegeId={row.collegeId} studentId={row.id} tracks={tracks} action={assignStudentPlacement} />
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
