import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, LoadError, PageHeader } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import { type CataloguePermission, groupResources } from "@/lib/permissions";
import { gateway } from "@/lib/server/gateway";
import { describeAccounts, listRoleAssignments } from "@/lib/server/people";
import { inColleges } from "@/lib/server/colleges";
import { collegesFor, requireStaff } from "@/lib/server/staff";
import { cn } from "@/lib/utils";
import { savePermissions } from "./actions";
import { PermissionEditor } from "./editor";

export const metadata: Metadata = { title: "Permissions" };

const STAFF_ROLES = new Set(["college_admin", "department_user", "mentor", "placement_user"]);
const ROLE_LABEL: Record<string, string> = { college_admin: "College admin", department_user: "Department", mentor: "Mentor", placement_user: "Placement" };

export default async function PermissionsPage({ searchParams }: { searchParams: Promise<{ person?: string; scope?: string; college?: string }> }) {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) redirect("/staff");
  const { person, scope: scopeParam, college: collegeParam } = await searchParams;
  const scope: "college" | "platform" = scopeParam === "platform" && staff.isPlatformAdmin ? "platform" : "college";

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
    const people = perCollege
      .flatMap(({ college, value }) => (value ?? []).map((entry) => ({ ...entry, collegeId: college.id, collegeName: college.name })))
      .sort((a, b) => a.name.localeCompare(b.name) || a.collegeName.localeCompare(b.collegeName));
    const chosen = people.find((entry) => entry.principalId === person && (!collegeParam || entry.collegeId === collegeParam)) ?? null;
    const path = scope === "platform" ? `/user/v1/staff/${chosen?.principalId}/permissions` : `/user/v1/tenants/${chosen?.collegeId}/staff/${chosen?.principalId}/permissions`;
    const held = chosen ? (await gateway<{ permissions: string[] }>(path)).permissions : [];
    data = { groups: groupResources(catalogue.permissions), people, chosen, held };
  } catch (error) {
    return (
      <>
      <PageHeader title="Permissions" />
        <LoadError error={error} />
      </>
    );
  }
  const { groups, people, chosen, held } = data;
  const href = (principalId: string, collegeId: string, scopeKind = scope) => `/staff/permissions?person=${principalId}&college=${collegeId}${scopeKind === "platform" ? "&scope=platform" : ""}`;

  return (
    <>
      <PageHeader
        title="Permissions"
        description="Give a person more than their role allows. Whatever the role already permits stays; these are added on top. Changing or deleting something always includes seeing it."
      />
      {people.length === 0 ? (
        <EmptyState>No staff yet. Create a staff account first, then come back to give them permissions.</EmptyState>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="Staff" className="xl:sticky xl:top-16 xl:self-start">
            <ul className="space-y-0.5">
              {people.map((entry) => (
                <li key={`${entry.collegeId}-${entry.principalId}`}>
                  <Link
                    href={href(entry.principalId, entry.collegeId)}
                    aria-current={chosen?.principalId === entry.principalId && chosen.collegeId === entry.collegeId ? "page" : undefined}
                    className={cn(
                      "flex flex-col rounded-[var(--radius-control)] px-3 py-2 transition-colors",
                      chosen?.principalId === entry.principalId ? "bg-hover" : "hover:bg-hover",
                    )}
                  >
                    <span className={cn("truncate text-[14px]", chosen?.principalId === entry.principalId ? "font-medium text-ink" : "text-ink-muted")}>{entry.name}</span>
                    <span className="truncate text-[12px] text-ink-subtle">{[staff.isPlatformAdmin ? entry.collegeName : "", ...entry.labels].filter(Boolean).join(", ")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="min-w-0">
            {!chosen ? (
              <EmptyState>Choose someone on the left.</EmptyState>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{chosen.name}</h2>
                  {chosen.labels.map((label) => (
                    <Badge key={label}>{label}</Badge>
                  ))}
                  {staff.isPlatformAdmin && (
                    <div className="ml-auto inline-flex rounded-[var(--radius-control)] border border-line p-0.5 text-[13px]" role="group" aria-label="Where these apply">
                      {(["college", "platform"] as const).map((kind) => (
                        <Link
                          key={kind}
                          href={href(chosen.principalId, chosen.collegeId, kind)}
                          aria-current={scope === kind ? "true" : undefined}
                          className={cn("rounded-[calc(var(--radius-control)-2px)] px-3 py-1 transition-colors", scope === kind ? "bg-hover font-medium text-ink" : "text-ink-muted hover:text-ink")}
                        >
                          {kind === "college" ? "This college" : "Every college"}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
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
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
