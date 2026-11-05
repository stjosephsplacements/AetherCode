import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { listBatches, listDepartments, listPlacement, departmentLabel } from "@/lib/server/directory";
import { describeAccounts, listRoleAssignments } from "@/lib/server/people";
import { inColleges } from "@/lib/server/colleges";
import { STAFF_ROLES } from "@/lib/rbac";
import { collegesFor, requireStaff } from "@/lib/server/staff";
import { CreateStaffDialog } from "./create-staff-form";
import { ImportStaffDialog } from "./import-staff-dialog";
import { StaffFilter, type StaffRow } from "./staff-filter";
import type { RoleChip } from "./roles";

export const metadata: Metadata = { title: "Staff accounts" };

export default async function StaffAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ college?: string; page?: string }>;
}) {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) redirect("/staff");

  let data;
  try {
    const query = await searchParams;
    const colleges = collegesFor(staff);
    const [perCollege, placement] = await Promise.all([
      inColleges(colleges, async (collegeId) => {
        const [allDepartments, batches, assignments] = await Promise.all([
          listDepartments(collegeId),
          listBatches(collegeId),
          listRoleAssignments(collegeId),
        ]);
        const active = assignments.filter((assignment) => assignment.status === "active" && STAFF_ROLES.has(assignment.role_name));
        const names = active.length ? await describeAccounts(collegeId, active.map((assignment) => assignment.principal_id)) : new Map();
        return {
          departments: allDepartments.filter((department) => department.department_type === "college"),
          batches,
          active,
          names,
          rawAssignments: assignments,
        };
      }),
      listPlacement(),
    ]);
    data = { perCollege, placement, page: query.page };
  } catch (error) {
    return (
      <>
        <PageHeader title="Staff accounts" />
        <LoadError error={error} />
      </>
    );
  }

  const { perCollege, placement, page } = data;
  const several = false; // /staff is one college (cross-college lists live in /admin), so no college picker or column

  const placementList = placement.organizations.flatMap((org) =>
    org.departments.map((dep) => ({ id: dep.id, name: `${departmentLabel(dep)}, ${org.legal_name}` }))
  );

  const unreachable = perCollege.filter((entry) => entry.failed).map((entry) => entry.college.name);
  const loaded = perCollege.flatMap(({ college, value }) => (value ? [{ college, ...value }] : []));
  const departments = loaded.flatMap((entry) =>
    entry.departments.map((department) => ({ ...department, collegeId: entry.college.id, collegeName: entry.college.name }))
  );

  // One row per person per college, with that college's roles and scopes.
  const staffRows: StaffRow[] = loaded.flatMap((entry) => {
    const scopeName = new Map<string, string>([
      ...entry.departments.map((department) => [department.id, department.name] as const),
      ...entry.batches.map((batch) => [batch.id, batch.name] as const),
      ...placementList.map((p) => [p.id, p.name] as const),
    ]);

    const label = (role: string, scope?: string) =>
      role === "college_admin"
        ? "College administrator"
        : role === "placement_user"
          ? `Placement officer, ${scopeName.get(scope ?? "") ?? "Placement"}`
          : `${role === "mentor" ? "Mentor" : "Faculty"}, ${scopeName.get(scope ?? "") ?? "another scope"}`;

    const people = new Map<string, { roles: RoleChip[]; roleTypes: Set<string> }>();
    for (const assignment of entry.active) {
      const prev = people.get(assignment.principal_id) ?? { roles: [], roleTypes: new Set() };
      prev.roles.push({ id: assignment.id, label: label(assignment.role_name, assignment.scope_id) });
      prev.roleTypes.add(assignment.role_name);
      people.set(assignment.principal_id, prev);
    }

    return [...people].map(([principalId, { roles, roleTypes }]) => {
      const person = entry.names.get(principalId);
      return {
        collegeId: entry.college.id,
        collegeName: entry.college.name,
        principalId,
        displayName: person?.display_name ?? "Unknown account",
        username: person?.username ?? person?.email ?? principalId.slice(0, 8),
        email: person?.email,
        status: person?.status ?? "active",
        roles,
        roleTypes: [...roleTypes],
        departments: entry.departments.map((department) => ({ id: department.id, name: department.name })),
        batches: entry.batches.filter((batch) => batch.status === "active").map((batch) => ({ id: batch.id, name: `${batch.name} (${batch.academic_year})` })),
      };
    });
  });

  staffRows.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <>
      <PageHeader
        title="Staff accounts"
        description="Faculty author questions and run exams for their department. Mentors follow batches. Placement officers oversee cohorts. College administrators manage overall college settings."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ImportStaffDialog departments={departments} />
            <CreateStaffDialog departments={departments} />
          </div>
        }
      />

      {unreachable.length > 0 && (
        <p role="alert" className="mb-4 text-sm text-warning">
          Could not load: {unreachable.join(", ")}.
        </p>
      )}

      <StaffFilter
        staffRows={staffRows}
        placementList={placementList}
        severalColleges={several}
        currentPage={page}
      />
    </>
  );
}
