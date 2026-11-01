"use client";

import { LoaderCircle, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FormMessage, Select, TextArea, TextInput, type ActionState } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";

export type EditField = {
  name: string;
  label: string;
  value: string;
  kind?: "text" | "textarea" | "number" | "datetime" | "select";
  options?: { value: string; label: string }[];
  hint?: string;
  /** A blank value is allowed (and sent) for this field. */
  optional?: boolean;
  min?: number;
  max?: number;
  step?: number;
};

/**
 * Edit one record in a dialog. Only the fields that changed go to `onSave`, which
 * matches the PATCH routes behind it (ADR-0054): what you did not touch stays as it was.
 */
export function EditDialog({
  title,
  description,
  fields,
  onSave,
  label = "Edit",
  trigger,
  size = "sm",
}: {
  title: string;
  description?: React.ReactNode;
  fields: EditField[];
  onSave: (changes: Record<string, string>) => Promise<ActionState>;
  label?: string;
  trigger?: React.ReactNode;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const current = (field: EditField) => values[field.name] ?? field.value;
  const changes = Object.fromEntries(fields.filter((field) => current(field) !== field.value).map((field) => [field.name, current(field)]));
  const blank = fields.find((field) => !field.optional && field.name in changes && changes[field.name]!.trim() === "");
  const ready = Object.keys(changes).length > 0 && !blank;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setValues({});
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="ghost" size={size}>
            <Pencil />
            {label}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={title} description={description}>
        <form
          className="space-y-4 p-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready || pending) return;
            startTransition(async () => {
              const result = await onSave(changes);
              if (result.error) return setError(result.error);
              setOpen(false);
              router.refresh();
            });
          }}
        >
          {fields.map((field) => {
            const id = `edit-${field.name}`;
            const set = (value: string) => {
              setValues((previous) => ({ ...previous, [field.name]: value }));
              setError(null);
            };
            return (
              <Field key={field.name} label={field.label} htmlFor={id} hint={field.hint}>
                {field.kind === "textarea" ? (
                  <TextArea id={id} value={current(field)} onChange={(event) => set(event.target.value)} className="min-h-32" />
                ) : field.kind === "select" ? (
                  <Select id={id} value={current(field)} onValueChange={set}>
                    {(field.options ?? []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <TextInput
                    id={id}
                    type={field.kind === "number" ? "number" : field.kind === "datetime" ? "datetime-local" : "text"}
                    value={current(field)}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    onChange={(event) => set(event.target.value)}
                  />
                )}
              </Field>
            );
          })}
          <FormMessage state={{ error }} />
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!ready || pending}>
              {pending && <LoaderCircle className="animate-spin" />}
              Save changes
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
