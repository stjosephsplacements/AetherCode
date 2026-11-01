"use client";

import { LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FormMessage, TextArea, TextInput, type ActionState } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";

const REASON_MAX = 500;

/**
 * Deleting asks why, because the service stores the reason with the row and the
 * audit log records who deleted what (ADR-0053). `confirmText` makes the person
 * type a name first, for things that are harder to put back.
 */
export function ConfirmDelete({
  label = "Delete",
  title,
  description,
  confirmText,
  onConfirm,
  redirectTo,
  size = "sm",
  trigger,
}: {
  label?: string;
  title: string;
  description: React.ReactNode;
  confirmText?: string;
  onConfirm: (reason: string) => Promise<ActionState>;
  /** Where to go after it is gone, when this page is about the deleted thing. Otherwise the page refreshes. */
  redirectTo?: string;
  size?: "sm" | "md";
  /** Replaces the default button. */
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = reason.trim().length > 0 && (!confirmText || typed.trim() === confirmText);

  function remove() {
    startTransition(async () => {
      const result = await onConfirm(reason.trim());
      if (result.error) return setError(result.error);
      setOpen(false);
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setReason("");
          setTyped("");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="ghost" size={size} className="text-danger hover:bg-danger-soft hover:text-danger">
            <Trash2 />
            {label}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={title} description={description}>
        <form
          className="space-y-4 p-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready && !pending) remove();
          }}
        >
          <Field label="Why are you deleting it?" htmlFor="delete-reason" hint="Kept with the record and shown in the audit log.">
            <TextArea id="delete-reason" value={reason} onChange={(event) => { setReason(event.target.value); setError(null); }} maxLength={REASON_MAX} className="min-h-24" autoFocus />
          </Field>
          {confirmText && (
            <Field label={`Type ${confirmText} to confirm`} htmlFor="delete-confirm">
              <TextInput id="delete-confirm" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} />
            </Field>
          )}
          <FormMessage state={{ error }} />
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Keep it
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!ready || pending} className="bg-danger text-canvas hover:bg-danger/90">
              {pending ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
              {label}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
