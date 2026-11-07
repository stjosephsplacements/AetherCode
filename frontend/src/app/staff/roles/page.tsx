import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmptyState, LoadError, PageHeader } from "@/components/staff/page-header";
import { type CataloguePermission, groupResources } from "@/lib/permissions";
import { gateway } from "@/lib/server/gateway";
import { collegeFor, requireStaff } from "@/lib/server/staff";
import { RoleList } from "./role-editor";

export const metadata: Metadata = { title: "Roles" };

type RoleData = {
  id: string;
  guild_kind: string;
  tenant_id?: string;
  name: string;
  tier: number;
  position: number;
  permissions: string[];
  managed: boolean;
  system_key?: string;
  version: number;
};

export default async function RolesPage() {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) redirect("/staff");
  const tenantId = collegeFor(staff);

  let data;
  try {
    const [rolesResponse, catalogueResponse] = await Promise.all([
      gateway<{ roles: RoleData[] }>(`/user/v1/tenants/${tenantId}/roles`),
      gateway<{ permissions: CataloguePermission[] }>("/user/v1/permission-catalogue"),
    ]);
    data = { roles: rolesResponse.roles, groups: groupResources(catalogueResponse.permissions) };
  } catch (error) {
    return (
      <>
        <PageHeader title="Roles" />
        <LoadError error={error} />
      </>
    );
  }

  const { roles, groups } = data;
  const sorted = [...roles].sort((a, b) => a.tier - b.tier || a.position - b.position || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title="Roles"
        description="Manage the roles in this college. Each role carries a set of permissions that apply to everyone who holds it. System-managed roles are read-only."
      />
      {sorted.length === 0 ? (
        <EmptyState>
          <p className="mb-3 text-[15px] font-medium text-ink">No roles yet</p>
          Roles are created when the college is bootstrapped. If you see none, the RBAC engine may not be active yet.
        </EmptyState>
      ) : (
        <RoleList roles={sorted} groups={groups} canManage={staff.canManageAccounts} />
      )}
    </>
  );
}
