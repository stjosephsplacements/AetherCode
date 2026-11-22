import type { Metadata } from "next";
import { EmptyState, LoadError, PageHeader, Table } from "@/components/staff/page-header";
import type { RoleAssignment } from "@/lib/api-types";
import { STAFF_ROLES } from "@/lib/rbac";
import { fetchAllPages } from "@/lib/server/fetch-all";
import { inColleges } from "@/lib/server/colleges";
import { listPlacement } from "@/lib/server/directory";
import { gateway } from "@/lib/server/gateway";
import { describeAccounts, listRoleAssignments } from "@/lib/server/people";
import { placementDepartmentOptions } from "@/lib/server/placement-org";
import { requireAdmin } from "@/lib/server/staff";
import { assignPlacementOfficer } from "../actions";
import { AssignOfficer, RemoveOfficerButton } from "./assign-officer";

export const metadata: Metadata = { title: "Placement officers" };

/** Assign college staff as placement officers on global tracks (ADR-0089). */
export default async function AdminPlacementOfficersPage() {
  const admin = await requireAdmin();
  let data;
  try {
    const placementDir = await listPlacement();
    const assignments = await fetchAllPages<RoleAssignment>("/user/v1/role-assignments?role_name=placement_user");
    const activePlacements = assignments.filter((a) => a.status === "active");
    const principalIds = [...new Set(activePlacements.map((a) => a.principal_id))];
    const colleges = admin.tenants.map((tenant) => ({ id: tenant.id, name: tenant.display_name }));

    const names = new Map<string, string>();
    if (principalIds.length > 0) {
      for (const college of colleges) {
        const described = await describeAccounts(college.id, principalIds).catch(() => new Map());
        for (const [id, account] of described) names.set(id, account.display_name);
      }
    }

    const candidates = await inColleges(colleges, async (collegeId) => {
      const active = (await listRoleAssignments(collegeId)).filter(
        (a) => a.status === "active" && STAFF_ROLES.has(a.role_name),
      );
      const described = active.length ? await describeAccounts(collegeId, active.map((a) => a.principal_id)) : new Map();
      return [...new Set(active.map((a) => a.principal_id))].map((id) => ({
        id,
        name: described.get(id)?.display_name ?? "Unknown",
      }));
    }).then((result) => {
      const all = result.flatMap(({ value }) => value ?? []);
      const seen = new Set<string>();
      return all.filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
    });

    data = { placementDir, assignments: activePlacements, names, candidates };
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="Officers" />
        <LoadError error={error} />
      </div>
    );
  }

  const tracks = placementDepartmentOptions(data.placementDir);
  const departmentName = new Map(tracks.map((track) => [track.id, track.label] as const));
  const officers = data.assignments.map((a) => ({
    assignmentId: a.id,
    principalId: a.principal_id,
    name: data.names.get(a.principal_id) ?? a.principal_id.slice(0, 8),
    department: departmentName.get(a.scope_id ?? "") ?? (a.scope_kind === "platform" ? "Platform-wide" : a.scope_id?.slice(0, 8) ?? "Unknown"),
  }));
  const placementDepartments = tracks.map((track) => ({ id: track.id, name: track.label }));
  const existingPrincipalIds = new Set(officers.map((o) => o.principalId));

  return (
    <div className="animate-enter space-y-6">
      <PageHeader
        title="Officers"
        description="Assign college staff to a placement department. They work in /placement for that track only."
        actions={
          placementDepartments.length > 0 ? (
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
          {placementDepartments.length > 0
            ? " Use the button above to assign one from existing staff."
            : " Create a placement department first."}
        </EmptyState>
      ) : (
        <Table head={["Name", "Placement department", ""]}>
          {officers.map((officer) => (
            <tr key={officer.assignmentId}>
              <td className="px-4 py-3 font-medium text-ink">{officer.name}</td>
              <td className="px-4 py-3 text-ink-muted">{officer.department}</td>
              <td className="px-4 py-2 text-right">
                <RemoveOfficerButton assignmentId={officer.assignmentId} name={officer.name} />
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
