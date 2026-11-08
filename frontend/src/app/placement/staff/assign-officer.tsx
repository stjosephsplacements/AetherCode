"use client";

import { Plus, X } from "@phosphor-icons/react/ssr";
import { useActionState, useState } from "react";
import { ActionForm, type ActionState, Field, FormMessage, Select, initialActionState } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { removePlacementOfficer } from "./actions";

export function AssignOfficer({
  candidates,
  departments,
  action,
}: {
  candidates: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  action: (previous: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={candidates.length === 0} title={candidates.length === 0 ? "No unassigned staff available" : undefined}>
          <Plus />
          Assign officer
        </Button>
      </DialogTrigger>
      <DialogContent title="Assign placement officer" description="Choose an existing staff member and the placement department they will manage." className="w-[min(92vw,480px)]">
        <div className="min-h-0 overflow-y-auto p-6">
          <ActionForm action={action} submitLabel="Assign" onSuccess={() => setOpen(false)}>
            <Field label="Staff member" htmlFor="officer-person">
              <Select id="officer-person" name="principal_id" required>
                {candidates.map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Placement department" htmlFor="officer-department">
              <Select id="officer-department" name="placement_department_id" required>
                {departments.map((dep) => (
                  <option key={dep.id} value={dep.id}>{dep.name}</option>
                ))}
              </Select>
            </Field>
          </ActionForm>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveOfficerButton({ assignmentId, name }: { assignmentId: string; name: string }) {
  const [state, action] = useActionState(removePlacementOfficer, initialActionState);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="role_assignment_id" value={assignmentId} />
      <button type="submit" aria-label={`Remove ${name}`} className="grid size-6 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-danger">
        <X className="size-3.5" />
      </button>
      {state.error && <span className="ml-1 text-xs text-danger">{state.error}</span>}
    </form>
  );
}
