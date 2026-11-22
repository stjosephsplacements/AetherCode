import type { RoleName } from "@/lib/api-types";
import { Lock, ShieldCheck } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { panel } from "@/app/admin/_dashboard/panel";
import { EmptyState, LoadError, PageHeader } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import { lettermark } from "@/lib/lettermark";
import { type CataloguePermission, groupResources } from "@/lib/permissions";
import { ROLE_SHORT, STAFF_ROLES } from "@/lib/rbac";
import { inColleges } from "@/lib/server/colleges";
import { gateway } from "@/lib/server/gateway";
import { describeAccounts, listRoleAssignments, listSuperAdmins } from "@/lib/server/people";
import { collegesFor, requireStaff } from "@/lib/server/staff";
import { cn } from "@/lib/utils";
import { savePermissions } from "./actions";
import { PermissionEditor } from "./editor";
import { PeopleList } from "./people-list";

function asCatalogue(payload: unknown): CataloguePermission[] {
  if (Array.isArray(payload)) return payload as CataloguePermission[];
  if (payload && typeof payload === "object") {
    const record = payload as { permissions?: unknown; items?: unknown };
    if (Array.isArray(record.permissions)) return record.permissions as CataloguePermission[];
    if (Array.isArray(record.items)) return record.items as CataloguePermission[];
  }
  return [];
}

/** Shared permissions console for college staff (`/staff/permissions`) and platform admins (`/admin/permissions`). */
export async function PermissionsScreen({
  basePath,
  searchParams,
  defaultScope = "college",
}: {
  basePath: "/staff/permissions" | "/admin/permissions";
  searchParams: Promise<{ person?: string; scope?: string; college?: string }>;
  defaultScope?: "college" | "platform";
}) {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) redirect(basePath.startsWith("/admin") ? "/admin" : "/staff");
  const { person, scope: scopeParam, college: collegeParam } = await searchParams;
  // Admin opens on platform scope; college links stay college unless `scope=platform` is set.
  const scope: "college" | "platform" =
    staff.isPlatformAdmin &&
    (scopeParam === "platform" || collegeParam === "platform" || (defaultScope === "platform" && !scopeParam && !collegeParam))
      ? "platform"
      : "college";

  let data;
  try {
    const colleges = collegesFor(staff);
    const [cataloguePayload, perCollege] = await Promise.all([
      gateway<unknown>("/user/v1/permission-catalogue"),
      inColleges(colleges, async (collegeId) => {
        const active = (await listRoleAssignments(collegeId)).filter((assignment) => assignment.status === "active" && STAFF_ROLES.has(assignment.role_name));
        const roles = new Map<string, string[]>();
        for (const assignment of active) {
          roles.set(assignment.principal_id, [...(roles.get(assignment.principal_id) ?? []), ROLE_SHORT[assignment.role_name as RoleName] ?? assignment.role_name]);
        }
        const names = roles.size ? await describeAccounts(collegeId, [...roles.keys()]) : new Map();
        return [...roles.entries()].map(([principalId, labels]) => ({
          principalId,
          labels: [...new Set(labels)],
          name: names.get(principalId)?.display_name ?? names.get(principalId)?.username ?? principalId.slice(0, 8),
        }));
      }),
    ]);
    const catalogue = asCatalogue(cataloguePayload);
    const superAdmins = staff.isPlatformAdmin ? await listSuperAdmins(staff.tenants, staff.viewer).catch(() => []) : [];
    const people = [
      ...superAdmins.map((admin) => ({
        principalId: admin.principalId,
        collegeId: "platform",
        collegeName: "Platform",
        name: admin.name,
        labels: [admin.root ? "Root" : "Super admin"],
        root: admin.root,
      })),
      ...perCollege
        .flatMap(({ college, value }) => (value ?? []).map((entry) => ({ ...entry, collegeId: college.id, collegeName: college.name, root: false })))
        .sort((a, b) => a.name.localeCompare(b.name) || a.collegeName.localeCompare(b.collegeName)),
    ];
    const chosen =
      people.find((entry) => entry.principalId === person && (!collegeParam ? entry.collegeId !== "platform" || scopeParam === "platform" || defaultScope === "platform" : entry.collegeId === collegeParam)) ??
      null;
    const viewerIsRoot = superAdmins.some((admin) => admin.root && admin.principalId === staff.viewer.principalId);
    const path =
      scope === "platform"
        ? `/user/v1/staff/${chosen?.principalId}/permissions`
        : `/user/v1/tenants/${chosen?.collegeId}/staff/${chosen?.principalId}/permissions`;
    const held = chosen && !chosen.root ? ((await gateway<{ permissions?: string[]; items?: string[] }>(path).catch(() => ({ permissions: [] })))?.permissions ?? []) : [];
    data = { groups: groupResources(catalogue), people, chosen, held, viewerIsRoot, catalogueCount: catalogue.length };
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="Permissions" />
        <LoadError error={error} />
      </div>
    );
  }

  const { groups, people, chosen, held, viewerIsRoot, catalogueCount } = data;
  const href = (principalId: string, collegeId: string, scopeKind = scope) =>
    `${basePath}?person=${principalId}&college=${collegeId}${scopeKind === "platform" ? "&scope=platform" : ""}`;
  const list = people.map((entry) => ({ ...entry, href: href(entry.principalId, entry.collegeId) }));
  const verbCount = groups.reduce((sum, group) => sum + group.resources.reduce((inner, resource) => inner + resource.verbs.length, 0), 0);

  return (
    <div className="animate-enter space-y-6">
      <PageHeader
        title="Permissions"
        description={`${people.length} people · ${verbCount || catalogueCount} grantable${chosen ? ` · ${held.length} extra for ${chosen.name}` : ""}. Grants stack on top of the role.`}
      />

      {people.length === 0 ? (
        <section className={cn(panel)}>
          <EmptyState>
            <p className="mb-3 text-[15px] font-medium text-ink">No staff yet</p>
            Create a staff account first, then come back to give them permissions.
          </EmptyState>
        </section>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <section aria-label="People">
            <div className="mb-3">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">People</h2>
              <p className="mt-0.5 text-[13px] text-ink-muted">Choose who to grant extras to.</p>
            </div>
            <PeopleList people={list} chosen={chosen} showCollege={staff.isPlatformAdmin} />
          </section>

          <div className="flex min-w-0 flex-col gap-4">
            {!chosen ? (
              <section className={cn(panel, "flex flex-1 flex-col justify-center")}>
                <EmptyState>
                  <span className="mx-auto mb-3 grid size-11 place-items-center rounded-control bg-brand/15 text-brand">
                    <ShieldCheck className="size-5" />
                  </span>
                  <p className="mb-2 text-[15px] font-medium text-ink">Select a person</p>
                  Choose someone on the left to see and change what they can do.
                </EmptyState>
              </section>
            ) : (
              <>
                {/* Focal: selected person */}
                <section aria-label="Selected person" className={cn(panel)}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-control bg-brand-soft font-mono text-[14px] font-semibold text-brand-soft-ink">
                      {lettermark(chosen.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] text-ink-muted">Selected</p>
                      <h2 className="mt-0.5 truncate text-[17px] font-semibold tracking-[-0.02em] text-ink">{chosen.name}</h2>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {chosen.labels.map((label) => (
                          <Badge key={label}>{label}</Badge>
                        ))}
                        {staff.isPlatformAdmin && <span className="text-[12px] text-ink-subtle">{chosen.collegeName}</span>}
                        {!chosen.root && <span className="font-mono text-[12px] tabular-nums text-ink-subtle">{held.length} extra</span>}
                      </div>
                    </div>
                    {staff.isPlatformAdmin && chosen.collegeId !== "platform" && (
                      <div className="inline-flex rounded-control border border-line bg-sidebar p-0.5 text-[13px]" role="group" aria-label="Where these apply">
                        {(["college", "platform"] as const).map((kind) => (
                          <Link
                            key={kind}
                            href={href(chosen.principalId, chosen.collegeId, kind)}
                            aria-current={scope === kind ? "true" : undefined}
                            className={cn(
                              "rounded-chip px-3 py-1.5 transition-colors",
                              scope === kind ? "bg-surface font-medium text-ink shadow-[var(--shadow-hairline)]" : "text-ink-muted hover:text-ink",
                            )}
                          >
                            {kind === "college" ? "This college" : "Every college"}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </section>

                <section aria-label="Permission editor" className={cn(panel, "flex-1")}>
                  {chosen.root ? (
                    <div className="text-sm text-ink-muted">
                      <p className="mb-1 flex items-center gap-2 text-[14px] font-medium text-ink">
                        <Lock className="size-4" />
                        Every permission, fixed
                      </p>
                      The root administrator holds every permission across every college. It cannot be edited or removed, so there is nothing to change here.
                    </div>
                  ) : chosen.collegeId === "platform" && !viewerIsRoot ? (
                    <p className="text-sm text-ink-muted">Only the root administrator edits a super admin&apos;s permissions.</p>
                  ) : (
                    <PermissionEditor
                      key={`${chosen.collegeId}-${chosen.principalId}-${scope}`}
                      groups={groups}
                      initial={held}
                      canGrantPlatformOnly={staff.isPlatformAdmin}
                      onSave={async (permissions) => {
                        "use server";
                        return savePermissions(chosen.principalId, scope, permissions, basePath);
                      }}
                    />
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
