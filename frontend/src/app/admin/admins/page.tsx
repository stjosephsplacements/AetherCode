import type { Metadata } from "next";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { inColleges } from "@/lib/server/colleges";
import { describeAccounts, listRoleAssignments, listSuperAdmins } from "@/lib/server/people";
import { requireAdmin } from "@/lib/server/staff";
import { PlatformAdmins } from "./platform-admins";

export const metadata: Metadata = { title: "Administrators" };

const STAFF_ROLES = new Set(["college_admin", "department_user", "mentor", "placement_user"]);

export default async function AdminsPage() {
  const staff = await requireAdmin();
  let data;
  try {
    const superAdmins = await listSuperAdmins(staff.tenants, staff.viewer);
    // Anyone with a staff role in a college can be made a platform administrator.
    const perCollege = await inColleges(
      staff.tenants.map((tenant) => ({ id: tenant.id, name: tenant.display_name })),
      async (collegeId) => {
        const active = (await listRoleAssignments(collegeId)).filter((assignment) => assignment.status === "active" && STAFF_ROLES.has(assignment.role_name));
        const names = active.length ? await describeAccounts(collegeId, active.map((assignment) => assignment.principal_id)) : new Map();
        return [...new Set(active.map((assignment) => assignment.principal_id))].map((id) => ({ id, name: names.get(id)?.display_name ?? "Unknown account" }));
      },
    );
    data = { superAdmins, perCollege };
  } catch (error) {
    return (
      <>
        <PageHeader title="Administrators" />
        <LoadError error={error} />
      </>
    );
  }
  const { superAdmins, perCollege } = data;
  const candidates = perCollege.flatMap(({ college, value }) => (value ?? []).map((person) => ({ id: person.id, label: `${person.name} (${college.name})` })));
  return (
    <>
      <PageHeader title="Administrators" description="People with platform-wide access. Narrow what each may do on the Permissions page." />
      <PlatformAdmins admins={superAdmins} candidates={candidates} viewerIsRoot={superAdmins.some((admin) => admin.root && admin.principalId === staff.viewer.principalId)} />
    </>
  );
}
