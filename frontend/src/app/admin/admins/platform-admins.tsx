import { Crown, Lock, ShieldCheck, UserGear, Users } from "@phosphor-icons/react/ssr";
import { CollegeLink } from "@/components/college-link";
import { ConfirmDelete } from "@/components/staff/confirm-delete";
import { Field, Select } from "@/components/staff/form";
import { EmptyState } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import { lettermark } from "@/lib/lettermark";
import type { SuperAdmin } from "@/lib/server/people";
import { makeSuperAdmin, removeSuperAdmin } from "../../staff/accounts/actions";
import { AddDialog } from "../../staff/departments/add-dialog";

/**
 * Platform administrators. The root administrator holds everything and is fixed.
 * A super admin the root adds holds every permission to begin with, and only the
 * root can narrow or remove them.
 */
export function PlatformAdmins({
  admins,
  candidates,
  viewerIsRoot,
}: {
  admins: SuperAdmin[];
  candidates: { id: string; label: string }[];
  viewerIsRoot: boolean;
}) {
  const pickable = candidates.filter((candidate) => !admins.some((admin) => admin.principalId === candidate.id));

  const addAdmin =
    viewerIsRoot ? (
      <AddDialog
        label="Add super admin"
        title="Add a super admin"
        description="They start with every permission. Narrow them on the Permissions page."
        submitLabel="Make super admin"
        action={makeSuperAdmin}
        disabledReason={pickable.length === 0 ? "Add a staff account first" : undefined}
      >
        <Field label="Staff member" htmlFor="super-admin-person">
          <Select id="super-admin-person" name="principal_id" required>
            {pickable.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </Select>
        </Field>
      </AddDialog>
    ) : null;

  return (
    <section aria-label="Platform administrators" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Roster</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {admins.length} administrator{admins.length === 1 ? "" : "s"}
            {viewerIsRoot
              ? pickable.length
                ? ` · ${pickable.length} staff can be promoted`
                : " · no one left to promote"
              : ""}
          </p>
        </div>
        {addAdmin}
      </div>

      {admins.length === 0 ? (
        <div className="rounded-surface border border-dashed border-line-strong bg-surface px-6 py-14 text-center shadow-[var(--shadow-panel)]">
          <EmptyState>No platform administrators yet.</EmptyState>
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-surface border border-line bg-surface shadow-[var(--shadow-panel)]">
          {admins.map((admin) => (
            <li key={admin.assignmentId} className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-hover sm:flex-nowrap">
              <span
                aria-hidden
                className="grid size-10 shrink-0 place-items-center rounded-control bg-brand-soft font-mono text-[13px] font-semibold text-brand-soft-ink"
              >
                {lettermark(admin.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[14.5px] font-semibold text-ink">
                  <span className="truncate">{admin.name}</span>
                  {admin.root ? (
                    <Badge tone="warning">
                      <Crown className="size-3" />
                      Root
                    </Badge>
                  ) : (
                    <Badge tone="neutral">
                      <ShieldCheck className="size-3" />
                      Super admin
                    </Badge>
                  )}
                </p>
                {admin.username && <p className="mt-0.5 truncate font-mono text-[11.5px] text-ink-subtle">@{admin.username}</p>}
                <p className="mt-0.5 text-[12.5px] text-ink-muted">
                  {admin.root ? "Every permission. Cannot be edited or removed." : "Permissions set by the root administrator."}
                </p>
              </div>

              <div className="flex w-full shrink-0 items-center gap-1 sm:w-auto sm:justify-end">
                {admin.root ? (
                  <span className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1.5 text-[12.5px] text-ink-subtle">
                    <Lock className="size-3.5" />
                    Fixed
                  </span>
                ) : viewerIsRoot ? (
                  <>
                    <CollegeLink
                      href={`/admin/permissions?person=${admin.principalId}&college=platform&scope=platform`}
                      className="rounded-pill px-3 py-1.5 text-[13px] font-medium text-brand transition-colors hover:bg-hover"
                    >
                      Permissions
                    </CollegeLink>
                    <ConfirmDelete
                      title={`Remove ${admin.name} as super admin?`}
                      description="They keep their staff account but lose every platform-wide permission."
                      confirmText={admin.username || admin.name}
                      onConfirm={async () => {
                        "use server";
                        const form = new FormData();
                        form.set("role_assignment_id", admin.assignmentId);
                        return removeSuperAdmin({ error: null }, form);
                      }}
                    />
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-subtle">
                    <UserGear className="size-3.5" />
                    Managed by root
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {viewerIsRoot && (
        <p className="flex items-start gap-2 text-[12.5px] text-ink-muted">
          <Users className="mt-0.5 size-3.5 shrink-0 text-ink-subtle" />
          {pickable.length
            ? `${pickable.length} staff account${pickable.length === 1 ? "" : "s"} can still be promoted.`
            : "Every staff account that can be promoted is already a platform administrator."}
        </p>
      )}
    </section>
  );
}
