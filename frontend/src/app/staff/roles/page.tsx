import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FigureCard } from "@/app/admin/_dashboard/charts";
import { panel } from "@/app/admin/_dashboard/panel";
import { EmptyState, LoadError, PageHeader } from "@/components/staff/page-header";
import { type CataloguePermission, groupResources } from "@/lib/permissions";
import { gateway } from "@/lib/server/gateway";
import { collegeFor, requireStaff } from "@/lib/server/staff";
import { cn } from "@/lib/utils";
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

/** Accept `{ roles }`, `{ items }`, a bare array, or a null/omitted list (nil Go slice → JSON null). */
function asRoles(payload: unknown): RoleData[] {
  if (Array.isArray(payload)) return payload as RoleData[];
  if (payload && typeof payload === "object") {
    const record = payload as { roles?: unknown; items?: unknown };
    if (Array.isArray(record.roles)) return record.roles as RoleData[];
    if (Array.isArray(record.items)) return record.items as RoleData[];
  }
  return [];
}

function asCatalogue(payload: unknown): CataloguePermission[] {
  if (Array.isArray(payload)) return payload as CataloguePermission[];
  if (payload && typeof payload === "object") {
    const record = payload as { permissions?: unknown; items?: unknown };
    if (Array.isArray(record.permissions)) return record.permissions as CataloguePermission[];
    if (Array.isArray(record.items)) return record.items as CataloguePermission[];
  }
  return [];
}

export default async function RolesPage() {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) redirect("/staff");
  const tenantId = collegeFor(staff);

  let data;
  try {
    const [rolesPayload, cataloguePayload] = await Promise.all([
      gateway<unknown>(`/user/v1/tenants/${tenantId}/roles`),
      gateway<unknown>("/user/v1/permission-catalogue"),
    ]);
    data = { roles: asRoles(rolesPayload), groups: groupResources(asCatalogue(cataloguePayload)) };
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="Roles" />
        <LoadError error={error} />
      </div>
    );
  }

  const { roles, groups } = data;
  const sorted = [...roles].sort((a, b) => a.tier - b.tier || a.position - b.position || a.name.localeCompare(b.name));
  const managed = sorted.filter((role) => role.managed).length;
  const custom = sorted.length - managed;

  return (
    <div className="animate-enter">
      <PageHeader
        title="Roles"
        description="Roles in this college. Each role gives a set of permissions to whoever holds it."
      />

      <div className="grid gap-3 xl:grid-cols-12">
        <FigureCard label="Roles" value={String(sorted.length)} note="this college" className="sm:col-span-1 xl:col-span-4" />
        <FigureCard label="System" value={String(managed)} note="managed, fixed" className="sm:col-span-1 xl:col-span-4" />
        <FigureCard label="Custom" value={String(custom)} note="editable by admins" className="sm:col-span-1 xl:col-span-4" />

        {sorted.length === 0 ? (
          <section className={cn(panel, "xl:col-span-12")}>
            <EmptyState>
              <p className="mb-3 text-[15px] font-medium text-ink">No roles yet</p>
              Roles are created when the college is bootstrapped. If you see none, the RBAC engine may not be active yet.
            </EmptyState>
          </section>
        ) : (
          <div className="xl:col-span-12">
            <RoleList roles={sorted} groups={groups} canManage={staff.canManageAccounts} />
          </div>
        )}
      </div>
    </div>
  );
}
