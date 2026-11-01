"use client";

import { LoaderCircle, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { createCategory } from "@/app/staff/questions/actions";
import { Field, FormMessage, Select, TextInput } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { CategoryRef } from "@/lib/api-types";

/**
 * Chooses a category, or adds one without leaving the form. Adding is open to
 * every author; a name that already exists (in any letter case) is selected
 * instead of duplicated (ADR-0052).
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
  onCreated,
  id,
}: {
  categories: CategoryRef[];
  value: string;
  onChange: (id: string) => void;
  onCreated: (category: CategoryRef) => void;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    startTransition(async () => {
      const result = await createCategory(name);
      if (result.error || !result.category) return setError(result.error ?? "The category could not be added.");
      onCreated(result.category);
      onChange(result.category.id);
      setOpen(false);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Select id={id} value={value} onValueChange={onChange} className="min-w-0 flex-1">
        {value === "" && <option value="">Choose a category</option>}
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </Select>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setName("");
            setError(null);
          }
        }}
      >
        <DialogTrigger asChild>
          <Button type="button" variant="secondary" className="h-10 shrink-0">
            <Plus />
            New
          </Button>
        </DialogTrigger>
        <DialogContent title="New category" description="Like Arrays, Strings or DP. Every college's authors can file questions under it.">
          <form
            className="space-y-4 p-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim()) add();
            }}
          >
            <Field label="Name" htmlFor="new-category-name">
              <TextInput id="new-category-name" value={name} onChange={(event) => { setName(event.target.value); setError(null); }} maxLength={80} placeholder="Dynamic Programming" autoFocus />
            </Field>
            <FormMessage state={{ error }} />
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pending || name.trim() === ""}>
                {pending && <LoaderCircle className="animate-spin" />}
                Add category
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
