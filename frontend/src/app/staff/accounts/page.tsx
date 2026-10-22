import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmptyState, LoadError, PageHeader, Section, Table } from "@/components/staff/page-header";
import { Badge, Panel } from "@/components/ui/card";
import { listBatches, listDepartments } from "@/lib/server/directory";
import { describeAccounts, listRoleAssignments } from "@/lib/server/people";
import { requireCollege } from "@/lib/server/staff";
import { StudentActions } from "../students/panels";
import { CreateStaffForm } from "./create-staff-form";
import { type RoleChip, RoleEditor } from "./roles";

export const metadata: Metadata = { title: "Staff accounts" };

const STAFF_ROLES = new Set(["college_admin", "department_user", "mentor"]);

export default async function StaffAccountsPage() {
  const staff = await requireCollege();
  if (!staff.canManageAccounts) redirect("/staff");
  let data;
  try {
    const [allDepartments, batches, assignments] = await Promise.all([
      listDepartments(staff.tenantId),
      listBatches(staff.tenantId),
      listRoleAssignments(staff.tenantId),
    ]);
    const active = assignments.filter((assignment) => assignment.status === "active" && STAFF_ROLES.has(assignment.role_name));
    const names = active.length ? await describeAccounts(staff.tenantId, active.map((assignment) => assignment.principal_id)) : new Map();
    data = { departments: allDepartments.filter((department) => department.department_type === "college"), batches, active, names };
  } catch (error) {
    return (
      <>
        <PageHeader title="Staff accounts" />
        <LoadError error={error} />
      </>
    );
  }
  const { departments, batches, active, names } = data;
  const scopeName = new Map<string, string>([
    ...departments.map((department) => [department.id, department.name] as const),
    ...batches.map((batch) => [batch.id, batch.name] as const),
  ]);
  const label = (role: string, scope?: string) =>
    role === "college_admin" ? "College administrator" : `${role === "mentor" ? "Mentor" : "Faculty"}, ${scopeName.get(scope ?? "") ?? "another scope"}`;
  const people = new Map<string, RoleChip[]>();
  for (const assignment of active) {
    people.set(assignment.principal_id, [...(people.get(assignment.principal_id) ?? []), { id: assignment.id, label: label(assignment.role_name, assignment.scope_id) }]);
  }
  const rows = [...people].sort(([a], [b]) => (names.get(a)?.display_name ?? a).localeCompare(names.get(b)?.display_name ?? b));

  return (
    <>
      <PageHeader
        title="Staff accounts"
        description="Faculty author questions and run exams for their department. Mentors follow their batches. College administrators also manage students, staff and departments."
      />
      <Panel className="p-5 sm:p-6">
        <CreateStaffForm departments={departments} />
      </Panel>
      <Section title="Staff" description="Every change here is recorded in the audit log.">
        {rows.length === 0 ? (
          <EmptyState>No staff yet.</EmptyState>
        ) : (
          <Table head={["Name", "Username", "Roles", ""]}>
            {rows.map(([principalId, roles]) => {
              const person = names.get(principalId);
              return (
                <tr key={principalId} className="border-t border-line align-top">
                  <td className="px-4 py-3">
                    <span className="font-medium text-ink">{person?.display_name ?? "Unknown account"}</span>
                    {person && person.status !== "active" && <Badge tone="danger" className="ml-2">{person.status}</Badge>}
                  </td>
                  <td className="px-4 py-3 font-mono text-[13px] text-ink-muted">{person?.username ?? person?.email ?? principalId.slice(0, 8)}</td>
                  <td className="px-4 py-3">
                    <RoleEditor principalId={principalId} roles={roles}
                      departments={departments.map((department) => ({ id: department.id, name: department.name }))}
                      batches={batches.filter((batch) => batch.status === "active").map((batch) => ({ id: batch.id, name: `${batch.name} (${batch.academic_year})` }))} />
                  </td>
                  <td className="px-4 py-3">
                    <StudentActions principalId={principalId} username={person?.username ?? ""} />
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
