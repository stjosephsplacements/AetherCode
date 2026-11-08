import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { departmentLabel, listBatches, listDepartments, listPlacement } from "@/lib/server/directory";
import { inColleges } from "@/lib/server/colleges";
import { type PlacementContext, requirePlacement } from "@/lib/server/placement";
import { listRoster } from "@/lib/server/students";
import { PlacementsBoard } from "./placements-filter";
import type { CandidateRow, OrgRow } from "./stats";

export const metadata: Metadata = { title: "Placements" };

export default async function PlacementsPage() {
  const placement = await requirePlacement();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Placements"
        description="Which students are in each placement track, across all colleges. Filter by organisation, department, batch or placement department to see who is assigned where."
      />
      <Suspense fallback={<PlacementsSkeleton />}>
        <PlacementsContent placement={placement} />
      </Suspense>
    </div>
  );
}

async function PlacementsContent({ placement: access }: { placement: PlacementContext }) {
  let data;
  try {
    const [placement, perCollege] = await Promise.all([
      listPlacement(),
      inColleges(access.colleges, async (collegeId) => {
        const [departments, batches] = await Promise.all([listDepartments(collegeId), listBatches(collegeId)]);
        const students = await listRoster(collegeId, batches.map((batch) => batch.id));
        return { departments, batches, students };
      }),
    ]);
    data = { placement, perCollege };
  } catch (error) {
    return <LoadError error={error} />;
  }
  const { placement, perCollege } = data;
  const several = access.colleges.length > 1;
  // The same department name appears in several colleges, so the lists say which college each is in.
  const suffix = (collegeName: string) => (several ? `, ${collegeName}` : "");

  const rows: CandidateRow[] = perCollege.flatMap(({ college: entry, value }) => {
    if (!value) return [];
    const departmentOf = new Map(value.departments.map((department) => [department.id, departmentLabel(department) + suffix(entry.name)]));
    const batchOf = new Map(value.batches.map((batch) => [batch.id, `${batch.name} (${batch.academic_year})`]));
    return value.students.map((student) => ({
      id: student.id,
      roll: student.enrollment_number,
      name: student.profile_name ?? "",
      status: student.status,
      college: entry.name,
      batchId: student.batch_id ?? "",
      batch: batchOf.get(student.batch_id ?? "") ?? "No batch",
      departmentId: student.college_department_id ?? "",
      department: departmentOf.get(student.college_department_id ?? "") ?? "",
      placementId: student.placement_department_id ?? "",
    }));
  });
  const departments = perCollege.flatMap(({ college: entry, value }) =>
    (value?.departments ?? []).filter((department) => department.department_type === "college").map((department) => ({ id: department.id, label: departmentLabel(department) + suffix(entry.name) })),
  );
  const batches = perCollege.flatMap(({ college: entry, value }) => (value?.batches ?? []).map((batch) => ({ id: batch.id, label: `${batch.name} (${batch.academic_year})${suffix(entry.name)}` })));
  const orgs: OrgRow[] = placement.organizations.map((org) => ({
    id: org.id,
    name: org.legal_name,
    code: org.code,
    status: org.status,
    tracks: org.departments.map((department) => ({ id: department.id, label: department.name })),
  }));
  const unreachable = perCollege.filter((entry) => entry.failed).map((entry) => entry.college.name);

  return (
    <>
      {unreachable.length > 0 && <p role="alert" className="text-sm text-warning">Could not load: {unreachable.join(", ")}.</p>}
      <PlacementsBoard rows={rows} orgs={orgs} readable={placement.readable} batches={batches} departments={departments} several={several} truncated={rows.length >= 5000} />
    </>
  );
}

/** The page's bands while the data loads, so nothing moves when it arrives. */
function PlacementsSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading placements">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-[118px] animate-pulse rounded-[var(--radius-surface)] border border-line bg-surface" />
        ))}
      </div>
      <div className="h-8 w-80 animate-pulse rounded-full bg-hover" />
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="h-52 animate-pulse rounded-[var(--radius-surface)] border border-line bg-surface" />
        ))}
      </div>
    </div>
  );
}
