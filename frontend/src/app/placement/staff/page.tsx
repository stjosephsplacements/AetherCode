import type { Metadata } from "next";
import { EmptyState, LoadError, PageHeader, Table } from "@/components/staff/page-header";
import type { Page, RoleAssignment } from "@/lib/api-types";
import { departmentLabel, listPlacement } from "@/lib/server/directory";
import { gateway } from "@/lib/server/gateway";
import { requirePlacement } from "@/lib/server/placement";
import { describeAccounts, listRoleAssignments } from "@/lib/server/people";
import { inColleges } from "@/lib/server/colleges";
import { STAFF_ROLES } from "@/lib/rbac";
import { AssignOfficer, RemoveOfficerButton } from "./assign-officer";
import { assignPlacementOfficer } from "./actions";

export const metadata: Metadata = { title: "Placement staff" };

export default async function PlacementStaffPage() {
  const placement = await requirePlacement();
  let data;
  try {
    const placementDir = await listPlacement();
    const assignments = await gateway<Page<RoleAssignment>>("/user/v1/role-assignments?role_name=placement_user&limit=100");
    const activePlacements = assignments.items.filter((a) => a.status === "active");
    const principalIds = [...new Set(activePlacements.map((a) => a.principal_id))];

    const names = new Map<string, string>();
    if (principalIds.length > 0) {
      for (const college of placement.colleges) {
        const described = await describeAccounts(college.id, principalIds).catch(() => new Map());
        for (const [id, account] of described) names.set(id, account.display_name);
      }
    }

    const candidates = placement.isPlatformAdmin
      ? await inColleges(placement.colleges, async (collegeId) => {
          const active = (await listRoleAssignments(collegeId)).filter((a) => a.status === "active" && STAFF_ROLES.has(a.role_name));
          const described = active.length ? await describeAccounts(collegeId, active.map((a) => a.principal_id)) : new Map();
          return [...new Set(active.map((a) => a.principal_id))].map((id) => ({ id, name: described.get(id)?.display_name ?? "Unknown" }));
        }).then((result) => {
          const all = result.flatMap(({ value }) => value ?? []);
          const seen = new Set<string>();
          return all.filter((c) => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
        })
      : [];

    data = { placementDir, assignments: activePlacements, names, candidates };
  } catch (error) {
    return (
      <>
        <PageHeader title="Placement staff" />
        <LoadError error={error} />
      </>
    );
  }

  const departmentName = new Map(
    data.placementDir.organizations.flatMap((org) =>
      org.departments.map((dep) => [dep.id, `${departmentLabel(dep)}, ${org.legal_name}`] as const)
    )
  );

  const officers = data.assignments.map((a) => ({
    assignmentId: a.id,
    principalId: a.principal_id,
    name: data.names.get(a.principal_id) ?? a.principal_id.slice(0, 8),
    department: departmentName.get(a.scope_id ?? "") ?? (a.scope_kind === "platform" ? "Platform-wide" : a.scope_id?.slice(0, 8) ?? "Unknown"),
    scopeKind: a.scope_kind,
  }));

  const placementDepartments = data.placementDir.organizations.flatMap((org) =>
    org.departments.map((dep) => ({ id: dep.id, name: `${departmentLabel(dep)}, ${org.legal_name}` }))
  );

  const existingPrincipalIds = new Set(officers.map((o) => o.principalId));

  return (
    <>
      <PageHeader
        title="Placement staff"
        description="People with access to the placement area. Admins assign staff here."
        actions={
          placement.isPlatformAdmin && placementDepartments.length > 0 ? (
            <AssignOfficer
              candidates={data.candidates.filter((c) => !existingPrincipalIds.has(c.id))}
              departments={placementDepartments}
              action={assignPlacementOfficer}
            />
          ) : undefined
        }
      />
      {officers.length === 0 ? (
        <EmptyState>
          No placement officers assigned yet.
          {placement.isPlatformAdmin
            ? placementDepartments.length > 0
              ? " Use the button above to assign one from existing staff."
              : " Create a placement department first."
            : ""}
        </EmptyState>
      ) : (
        <Table head={["Name", "Placement department", ...(placement.isPlatformAdmin ? [""] : [])]}>
          {officers.map((officer) => (
            <tr key={officer.assignmentId}>
              <td className="px-4 py-3 font-medium text-ink">{officer.name}</td>
              <td className="px-4 py-3 text-ink-muted">{officer.department}</td>
              {placement.isPlatformAdmin && (
                <td className="px-4 py-2 text-right">
                  <RemoveOfficerButton assignmentId={officer.assignmentId} name={officer.name} />
                </td>
              )}
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
