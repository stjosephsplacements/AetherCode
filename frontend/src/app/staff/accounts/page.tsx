import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmptyState, LoadError, PageHeader, Section, Table } from "@/components/staff/page-header";
import { CollegeFilter } from "@/components/staff/college-filter";
import { Badge, Panel } from "@/components/ui/card";
import { listBatches, listDepartments, listPlacement, departmentLabel } from "@/lib/server/directory";
import { describeAccounts, listRoleAssignments } from "@/lib/server/people";
import { inColleges } from "@/lib/server/colleges";
import { collegesFor, requireStaff } from "@/lib/server/staff";
import { StudentActions } from "../students/panels";
import { CreateStaffForm } from "./create-staff-form";
import { ImportStaffDialog } from "./import-staff-dialog";
import { type RoleChip, RoleEditor } from "./roles";

export const metadata: Metadata = { title: "Staff accounts" };

const STAFF_ROLES = new Set(["college_admin", "department_user", "mentor", "placement_user"]);

export default async function StaffAccountsPage({ searchParams }: { searchParams: Promise<{ college?: string }> }) {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) redirect("/staff");
  let data;
  try {
    const colleges = collegesFor(staff, (await searchParams).college);
    const [perCollege, placement] = await Promise.all([
      inColleges(colleges, async (collegeId) => {
        const [allDepartments, batches, assignments] = await Promise.all([listDepartments(collegeId), listBatches(collegeId), listRoleAssignments(collegeId)]);
        const active = assignments.filter((assignment) => assignment.status === "active" && STAFF_ROLES.has(assignment.role_name));
        const names = active.length ? await describeAccounts(collegeId, active.map((assignment) => assignment.principal_id)) : new Map();
        return { departments: allDepartments.filter((department) => department.department_type === "college"), batches, active, names };
      }),
      listPlacement(),
    ]);
    data = { perCollege, placement };
  } catch (error) {
    return (
      <>
      <PageHeader title="Staff accounts" />
        <LoadError error={error} />
      </>
    );
  }
  const { perCollege, placement } = data;
  const several = staff.isPlatformAdmin;
  const placementList = placement.organizations.flatMap((org) =>
    org.departments.map((dep) => ({ id: dep.id, name: `${departmentLabel(dep)}, ${org.legal_name}` }))
  );
  const unreachable = perCollege.filter((entry) => entry.failed).map((entry) => entry.college.name);
  const loaded = perCollege.flatMap(({ college, value }) => (value ? [{ college, ...value }] : []));
  const departments = loaded.flatMap((entry) => entry.departments.map((department) => ({ ...department, collegeId: entry.college.id, collegeName: entry.college.name })));
  // One row per person per college, with that college's roles and scopes.
  const rows = loaded.flatMap((entry) => {
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
    const people = new Map<string, RoleChip[]>();
    for (const assignment of entry.active) {
      people.set(assignment.principal_id, [...(people.get(assignment.principal_id) ?? []), { id: assignment.id, label: label(assignment.role_name, assignment.scope_id) }]);
    }
    return [...people].map(([principalId, roles]) => ({ entry, principalId, roles }));
  });
  rows.sort((a, b) => (a.entry.names.get(a.principalId)?.display_name ?? a.principalId).localeCompare(b.entry.names.get(b.principalId)?.display_name ?? b.principalId));

  return (
    <>
      <PageHeader
        actions={staff.isPlatformAdmin ? <CollegeFilter colleges={staff.tenants.map((tenant) => ({ id: tenant.id, name: tenant.display_name }))} /> : undefined}
        title="Staff accounts"
        description="Faculty author questions and run exams for their department. Mentors follow their batches. Placement officers oversee student placement cohorts. College administrators also manage students, staff and departments."
      />
      <Panel className="p-5 sm:p-6">
        <CreateStaffForm departments={departments} colleges={staff.isPlatformAdmin ? staff.tenants.map((tenant) => ({ id: tenant.id, name: tenant.display_name })) : undefined} />
        <div className="mt-4 border-t border-line pt-4">
          <ImportStaffDialog departments={departments} colleges={staff.isPlatformAdmin ? staff.tenants.map((tenant) => ({ id: tenant.id, name: tenant.display_name })) : undefined} />
        </div>
      </Panel>
      {unreachable.length > 0 && <p role="alert" className="mb-4 text-sm text-warning">Could not load: {unreachable.join(", ")}.</p>}
      <Section title="Staff" description="Every change here is recorded in the audit log.">
        {rows.length === 0 ? (
          <EmptyState>No staff yet.</EmptyState>
        ) : (
          <Table head={several ? ["Name", "College", "Username", "Roles", ""] : ["Name", "Username", "Roles", ""]}>
            {rows.map(({ entry, principalId, roles }) => {
              const person = entry.names.get(principalId);
              return (
                <tr key={`${entry.college.id}-${principalId}`} className="border-t border-line align-top">
                  <td className="px-4 py-3">
                    <span className="font-medium text-ink">{person?.display_name ?? "Unknown account"}</span>
                    {person && person.status !== "active" && <Badge tone="danger" className="ml-2">{person.status}</Badge>}
                  </td>
                  {several && <td className="px-4 py-3 text-ink-muted">{entry.college.name}</td>}
                  <td className="px-4 py-3 font-mono text-[13px] text-ink-muted">{person?.username ?? person?.email ?? principalId.slice(0, 8)}</td>
                  <td className="px-4 py-3">
                    <RoleEditor collegeId={entry.college.id} principalId={principalId} roles={roles}
                      departments={entry.departments.map((department) => ({ id: department.id, name: department.name }))}
                      batches={entry.batches.filter((batch) => batch.status === "active").map((batch) => ({ id: batch.id, name: `${batch.name} (${batch.academic_year})` }))}
                      placements={placementList} />
                  </td>
                  <td className="px-4 py-3">
                    <StudentActions principalId={principalId} username={person?.username ?? ""} collegeId={entry.college.id} />
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>
    </>
  );
}
