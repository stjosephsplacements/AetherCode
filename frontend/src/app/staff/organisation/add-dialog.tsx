"use client";

import { Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ActionForm, type ActionState } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

/** A "+ Add" button that opens its form in a dialog and closes it once the save goes through. */
export function AddDialog({
  label,
  title,
  description,
  submitLabel,
  action,
  disabledReason,
  variant = "primary",
  children,
}: {
  label: string;
  title: string;
  description?: string;
  submitLabel: string;
  action: (previous: ActionState, form: FormData) => Promise<ActionState>;
  /** Why the button is off, shown as its tooltip. */
  disabledReason?: string;
  variant?: "primary" | "secondary";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size="sm" disabled={Boolean(disabledReason)} title={disabledReason}>
          <Plus />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent title={title} description={description} className="w-[min(92vw,520px)]">
        <div className="min-h-0 overflow-y-auto p-6">
          <ActionForm action={action} submitLabel={submitLabel} onSuccess={() => setOpen(false)}>
            {children}
          </ActionForm>
        </div>
      </DialogContent>
    </Dialog>
  );
}
