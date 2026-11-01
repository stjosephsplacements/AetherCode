"use client";

import { X } from "lucide-react";
import { useActionState, useState } from "react";
import { FormMessage, initialActionState } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { grantRole, revokeRole } from "./actions";

export type RoleChip = { id: string; label: string };
type Option = { id: string; name: string };

const ROLE_LABELS = {
  college_admin: "College administrator",
  department_user: "Faculty of a department",
  mentor: "Mentor of batches",
  placement_user: "Placement officer",
} as const;

/** A staff member's roles, each removable, and a form to give another (ADR-0043 audits both). */
export function RoleEditor({
  principalId,
  roles,
  departments,
  batches,
  placements = [],
}: {
  principalId: string;
  roles: RoleChip[];
  departments: Option[];
  batches: Option[];
  placements?: Option[];
}) {
  const [revoked, revokeAction] = useActionState(revokeRole, initialActionState);
  const [granted, grantAction] = useActionState(grantRole, initialActionState);
  const [role, setRole] = useState<keyof typeof ROLE_LABELS>("department_user");
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {roles.map((chip) => (
          <form key={chip.id} action={revokeAction} className="inline-flex items-center gap-1 rounded-full bg-hover py-0.5 pl-2.5 pr-1 text-xs text-ink">
            {chip.label}
            <input type="hidden" name="role_assignment_id" value={chip.id} />
            <button type="submit" aria-label={`Remove ${chip.label}`} className="grid size-5 place-items-center rounded-full text-ink-muted hover:bg-surface hover:text-danger">
              <X className="size-3" />
            </button>
          </form>
        ))}
        <button type="button" onClick={() => setOpen((value) => !value)} className="rounded-full px-2.5 py-0.5 text-xs text-brand hover:bg-brand-soft">
          {open ? "Cancel" : "+ Add role"}
        </button>
      </div>
      <FormMessage state={revoked} />
      {open && (
        <form action={grantAction} className="space-y-2 rounded-[var(--radius-control)] border border-line bg-canvas/40 p-3">
          <input type="hidden" name="principal_id" value={principalId} />
          <select name="role" value={role} onChange={(event) => setRole(event.target.value as keyof typeof ROLE_LABELS)}
            className="h-8 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm">
            {Object.entries(ROLE_LABELS)
              // Placement scopes are visible only to platform administrators.
              .filter(([value]) => value !== "placement_user" || placements.length > 0)
              .map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
          </select>
          {role === "department_user" && (
            <select name="department_id" className="h-8 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm">
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
          )}
          {role === "placement_user" && (
            <select name="placement_department_id" className="h-8 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm">
              {placements.map((placement) => (
                <option key={placement.id} value={placement.id}>{placement.name}</option>
              ))}
            </select>
          )}
          {role === "mentor" && (
            <fieldset className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto text-sm">
              <legend className="mb-1 text-xs text-ink-muted">Batches (choose any number)</legend>
              {batches.map((batch) => (
                <label key={batch.id} className="flex items-center gap-2">
                  <input type="checkbox" name="batch_id" value={batch.id} />
                  {batch.name}
                </label>
              ))}
            </fieldset>
          )}
          <FormMessage state={granted} />
          <Button type="submit" size="sm">Give role</Button>
        </form>
      )}
    </div>
  );
}
