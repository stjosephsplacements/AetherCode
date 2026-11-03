import { Key, Lock, ShieldCheck, Users } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { EmptyState, LoadError, PageHeader } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import { type CataloguePermission, groupResources } from "@/lib/permissions";
import { gateway } from "@/lib/server/gateway";
import { describeAccounts, listRoleAssignments, listSuperAdmins } from "@/lib/server/people";
import { inColleges } from "@/lib/server/colleges";
import { collegesFor, requireStaff } from "@/lib/server/staff";
import { cn } from "@/lib/utils";
import { savePermissions } from "./actions";
import { lettermark } from "../placements/stats";
import { PermissionEditor } from "./editor";
import { PeopleList } from "./people-list";

export const metadata: Metadata = { title: "Permissions" };

const STAFF_ROLES = new Set(["college_admin", "department_user", "mentor", "placement_user"]);
const ROLE_LABEL: Record<string, string> = { college_admin: "College admin", department_user: "Department", mentor: "Mentor", placement_user: "Placement" };

export default async function PermissionsPage({ searchParams }: { searchParams: Promise<{ person?: string; scope?: string; college?: string }> }) {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) redirect("/staff");
  const { person, scope: scopeParam, college: collegeParam } = await searchParams;
  const scope: "college" | "platform" = (scopeParam === "platform" || collegeParam === "platform") && staff.isPlatformAdmin ? "platform" : "college";

  let data;
  try {
    const colleges = collegesFor(staff, undefined);
    const [catalogue, perCollege] = await Promise.all([
      gateway<{ permissions: CataloguePermission[] }>("/user/v1/permission-catalogue"),
      inColleges(colleges, async (collegeId) => {
        const active = (await listRoleAssignments(collegeId)).filter((assignment) => assignment.status === "active" && STAFF_ROLES.has(assignment.role_name));
        const roles = new Map<string, string[]>();
        for (const assignment of active) roles.set(assignment.principal_id, [...(roles.get(assignment.principal_id) ?? []), ROLE_LABEL[assignment.role_name] ?? assignment.role_name]);
        const names = roles.size ? await describeAccounts(collegeId, [...roles.keys()]) : new Map();
        return [...roles.entries()].map(([principalId, labels]) => ({ principalId, labels: [...new Set(labels)], name: names.get(principalId)?.display_name ?? names.get(principalId)?.username ?? principalId.slice(0, 8) }));
      }),
    ]);
    const superAdmins = staff.isPlatformAdmin ? await listSuperAdmins(staff.tenants, staff.viewer).catch(() => []) : [];
    const people = [
      ...superAdmins.map((admin) => ({ principalId: admin.principalId, collegeId: "platform", collegeName: "Platform", name: admin.name, labels: [admin.root ? "Root" : "Super admin"], root: admin.root })),
      ...perCollege
        .flatMap(({ college, value }) => (value ?? []).map((entry) => ({ ...entry, collegeId: college.id, collegeName: college.name, root: false })))
        .sort((a, b) => a.name.localeCompare(b.name) || a.collegeName.localeCompare(b.collegeName)),
    ];
    const chosen = people.find((entry) => entry.principalId === person && (!collegeParam ? entry.collegeId !== "platform" || scopeParam === "platform" : entry.collegeId === collegeParam)) ?? null;
    const viewerIsRoot = superAdmins.some((admin) => admin.root && admin.principalId === staff.viewer.principalId);
    const path = scope === "platform" ? `/user/v1/staff/${chosen?.principalId}/permissions` : `/user/v1/tenants/${chosen?.collegeId}/staff/${chosen?.principalId}/permissions`;
    const held = chosen && !chosen.root ? (await gateway<{ permissions: string[] }>(path)).permissions : [];
    data = { groups: groupResources(catalogue.permissions), people, chosen, held, viewerIsRoot };
  } catch (error) {
    return (
      <>
      <PageHeader title="Permissions" />
        <LoadError error={error} />
      </>
    );
  }
  const { groups, people, chosen, held, viewerIsRoot } = data;
  const href = (principalId: string, collegeId: string, scopeKind = scope) => `/staff/permissions?person=${principalId}&college=${collegeId}${scopeKind === "platform" ? "&scope=platform" : ""}`;

  const list = people.map((entry) => ({ ...entry, href: href(entry.principalId, entry.collegeId) }));
  const chip = (icon: ReactNode, label: string, value: number) => (
    <li className="inline-flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-2.5 pr-3 text-[13px] text-ink-muted">
      <span aria-hidden className="text-brand">{icon}</span>
      {label}
      <span className="font-mono tabular-nums text-ink">{value}</span>
    </li>
  );

  return (
    <>
      <PageHeader
        title="Permissions"
        description="Give a person more than their role allows. Whatever the role already permits stays; these are added on top. Changing or deleting something always includes seeing it."
      />
      <ul className="mb-5 flex flex-wrap gap-2" aria-label="Summary">
        {chip(<Users className="size-3.5" />, "Staff", people.length)}
        {chip(<ShieldCheck className="size-3.5" />, "Permissions in the catalogue", groups.reduce((sum, group) => sum + group.resources.reduce((inner, resource) => inner + resource.verbs.length, 0), 0))}
        {chosen && chip(<Key className="size-3.5" />, `Extra for ${chosen.name.split(" ")[0]}`, held.length)}
      </ul>
      {people.length === 0 ? (
        <EmptyState>
          <p className="mb-3 text-[15px] font-medium text-ink">No staff yet</p>
          Create a staff account first, then come back to give them permissions.
        </EmptyState>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
          <PeopleList people={list} chosen={chosen} showCollege={staff.isPlatformAdmin} />
          <div className="min-w-0">
            {!chosen ? (
              <EmptyState>Choose someone on the left to see and change what they can do.</EmptyState>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-surface)] border border-line bg-surface px-4 py-3">
                  <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft font-mono text-[13px] font-semibold text-brand-soft-ink">
                    {lettermark(chosen.name)}
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-[16px] font-semibold tracking-[-0.01em] text-ink">{chosen.name}</h2>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      {chosen.labels.map((label) => (
                        <Badge key={label}>{label}</Badge>
                      ))}
                      {staff.isPlatformAdmin && <span className="text-[12px] text-ink-subtle">{chosen.collegeName}</span>}
                    </div>
                  </div>
                  {staff.isPlatformAdmin && chosen.collegeId !== "platform" && (
                    <div className="ml-auto inline-flex rounded-[var(--radius-control)] border border-line bg-sidebar p-0.5 text-[13px]" role="group" aria-label="Where these apply">
                      {(["college", "platform"] as const).map((kind) => (
                        <Link
                          key={kind}
                          href={href(chosen.principalId, chosen.collegeId, kind)}
                          aria-current={scope === kind ? "true" : undefined}
                          className={cn("rounded-[calc(var(--radius-control)-2px)] px-3 py-1 transition-colors", scope === kind ? "bg-surface font-medium text-ink shadow-[var(--shadow-hairline)]" : "text-ink-muted hover:text-ink")}
                        >
                          {kind === "college" ? "This college" : "Every college"}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
                {chosen.root ? (
                  <div className="rounded-[var(--radius-surface)] border border-line bg-surface p-6 text-sm text-ink-muted">
                    <p className="mb-1 flex items-center gap-2 font-medium text-ink">
                      <Lock className="size-4" />
                      Every permission, fixed
                    </p>
                    The root administrator holds every permission across every college. It cannot be edited or removed, so there is nothing to change here.
                  </div>
                ) : chosen.collegeId === "platform" && !viewerIsRoot ? (
                  <div className="rounded-[var(--radius-surface)] border border-line bg-surface p-6 text-sm text-ink-muted">Only the root administrator edits a super admin&apos;s permissions.</div>
                ) : (
                <PermissionEditor
                  key={`${chosen.collegeId}-${chosen.principalId}-${scope}`}
                  groups={groups}
                  initial={held}
                  canGrantPlatformOnly={staff.isPlatformAdmin}
                  onSave={async (permissions) => {
                    "use server";
                    return savePermissions(chosen.principalId, scope, permissions, chosen.collegeId);
                  }}
                />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
