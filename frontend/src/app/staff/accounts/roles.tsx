"use client";

import { X } from "lucide-react";
import { useActionState, useState } from "react";
import { Checkbox, FormMessage, Select, initialActionState } from "@/components/staff/form";
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
  collegeId,
  principalId,
  roles,
  departments,
  batches,
  placements = [],
}: {
  collegeId: string;
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
            <input type="hidden" name="college_id" value={collegeId} />
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
          <input type="hidden" name="college_id" value={collegeId} />
          <Select name="role" aria-label="Role" size="sm" className="w-full" value={role} onValueChange={(value) => setRole(value as keyof typeof ROLE_LABELS)}>
            {Object.entries(ROLE_LABELS)
              // Placement scopes are visible only to platform administrators.
              .filter(([value]) => value !== "placement_user" || placements.length > 0)
              .map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
          </Select>
          {role === "department_user" && (
            <Select name="department_id" aria-label="Department" size="sm" className="w-full">
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </Select>
          )}
          {role === "placement_user" && (
            <Select name="placement_department_id" aria-label="Placement department" size="sm" className="w-full">
              {placements.map((placement) => (
                <option key={placement.id} value={placement.id}>{placement.name}</option>
              ))}
            </Select>
          )}
          {role === "mentor" && (
            <fieldset className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto text-sm">
              <legend className="mb-1 text-xs text-ink-muted">Batches (choose any number)</legend>
              {batches.map((batch) => (
                <label key={batch.id} className="flex items-center gap-2">
                  <Checkbox name="batch_id" value={batch.id} />
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
