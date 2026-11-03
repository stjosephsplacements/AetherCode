import { Crown, Lock, ShieldCheck } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { ConfirmDelete } from "@/components/staff/confirm-delete";
import { Field, Select } from "@/components/staff/form";
import { Badge } from "@/components/ui/card";
import type { SuperAdmin } from "@/lib/server/people";
import { AddDialog } from "../departments/add-dialog";
import { lettermark } from "../placements/stats";
import { makeSuperAdmin, removeSuperAdmin } from "./actions";

/**
 * Platform administrators. The root administrator holds everything and is fixed.
 * A super admin the root adds holds every permission to begin with, and only the
 * root can narrow or remove them.
 */
export function PlatformAdmins({ admins, candidates, viewerIsRoot }: { admins: SuperAdmin[]; candidates: { id: string; label: string }[]; viewerIsRoot: boolean }) {
  const pickable = candidates.filter((candidate) => !admins.some((admin) => admin.principalId === candidate.id));
  return (
    <section aria-label="Platform administrators" className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Platform administrators</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">Across every college. The root administrator is fixed; the others hold what the root gives them.</p>
        </div>
        {viewerIsRoot && (
          <AddDialog
            label="Add super admin"
            title="Add a super admin"
            description="They start with every permission. Narrow them on the Permissions page."
            submitLabel="Make super admin"
            action={makeSuperAdmin}
            disabledReason={pickable.length === 0 ? "Add a staff account first" : undefined}
            variant="secondary"
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
        )}
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
        {admins.map((admin) => (
          <li key={admin.assignmentId} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft font-mono text-[12px] font-semibold text-brand-soft-ink">
              {lettermark(admin.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-ink">
                {admin.name}
                {admin.root ? (
                  <Badge tone="warning">
                    <Crown className="mr-1 size-3" />
                    Root
                  </Badge>
                ) : (
                  <Badge tone="neutral">
                    <ShieldCheck className="mr-1 size-3" />
                    Super admin
                  </Badge>
                )}
              </p>
              <p className="text-[12px] text-ink-subtle">
                {admin.username && <span className="mr-2 font-mono">@{admin.username}</span>}
                {admin.root ? "Every permission. Cannot be edited or removed." : "Permissions set by the root administrator."}
              </p>
            </div>
            {admin.root ? (
              <Lock aria-label="Fixed" className="size-4 text-ink-subtle" />
            ) : (
              viewerIsRoot && (
                <div className="flex items-center gap-1">
                  <Link href={`/staff/permissions?person=${admin.principalId}&scope=platform`} className="rounded-full px-3 py-1.5 text-[13px] text-brand transition-colors hover:bg-hover">
                    Permissions
                  </Link>
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
                </div>
              )
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
