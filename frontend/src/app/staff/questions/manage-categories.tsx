"use client";

import { Check, FolderCog, LoaderCircle, Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FormMessage, Select, TextInput } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { Category } from "@/lib/api-types";
import { cn } from "@/lib/utils";
import { inFolderOrder } from "@/lib/categories";
import { createCategory, deleteCategory, updateCategory } from "./actions";

const UNCATEGORISED = "018f4b0d-08f8-7c09-9ba7-efdf9c220c01";

/**
 * Administrators rename, merge and delete categories here. A deleted category's
 * questions move to the one chosen (or to Uncategorised), so nothing is lost
 * and no question is left without a category (ADR-0052). A category can sit
 * under a top-level one, a level deep at most; deleting waits until its
 * sub-categories are gone (ADR-0058).
 */
export function ManageCategories({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [freshParent, setFreshParent] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [target, setTarget] = useState(UNCATEGORISED);
  const [fresh, setFresh] = useState("");
  const [message, setMessage] = useState<{ error: string | null; message?: string | null }>({ error: null });
  const [pending, startTransition] = useTransition();

  const topLevel = categories.filter((category) => !category.parent_id && category.id !== UNCATEGORISED);

  const run = (work: () => Promise<{ error: string | null; message?: string | null }>, done?: () => void) =>
    startTransition(async () => {
      const result = await work();
      setMessage(result);
      if (!result.error) {
        done?.();
        router.refresh();
      }
    });

  return (
    <Dialog onOpenChange={() => { setEditing(null); setRemoving(null); setMessage({ error: null }); }}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <FolderCog />
          Manage categories
        </Button>
      </DialogTrigger>
      <DialogContent title="Manage categories" description="Rename a category, or delete one and move its questions into another. Uncategorised is built in." className="w-[min(94vw,640px)]">
        <div className="min-h-0 space-y-5 overflow-y-auto p-6">
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-control)] border border-line">
            {inFolderOrder(categories).map(({ category, depth }) => {
              const builtIn = category.id === UNCATEGORISED;
              const children = categories.filter((child) => child.parent_id === category.id).length;
              return (
                <li key={category.id} className={cn("px-4 py-3", depth === 1 && "pl-9")}>
                  {editing === category.id ? (
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const parentId = parent || null;
                        run(() => updateCategory(category.id, { name, ...(parentId !== (category.parent_id ?? null) ? { parentId } : {}) }), () => setEditing(null));
                      }}
                    >
                      <TextInput value={name} onChange={(event) => setName(event.target.value)} maxLength={80} aria-label={`New name for ${category.name}`} className="h-9 flex-1" autoFocus />
                      {children === 0 && (
                        <Select aria-label={`Where ${category.name} sits`} size="sm" className="w-40" value={parent} onValueChange={setParent}>
                          <option value="">Top level</option>
                          {topLevel.filter((other) => other.id !== category.id).map((other) => (
                            <option key={other.id} value={other.id}>
                              {other.name}
                            </option>
                          ))}
                        </Select>
                      )}
                      <Button type="submit" size="sm" disabled={pending || name.trim() === ""}>
                        {pending ? <LoaderCircle className="animate-spin" /> : <Check />}
                        Save
                      </Button>
                      <Button type="button" size="icon" variant="ghost" aria-label="Cancel" onClick={() => setEditing(null)}>
                        <X />
                      </Button>
                    </form>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{category.name}</span>
                        <span className="font-mono text-[11.5px] text-ink-subtle">
                          {category.question_count} {category.question_count === 1 ? "question" : "questions"}
                          {children > 0 && `, ${children} ${children === 1 ? "sub-category" : "sub-categories"}`}
                        </span>
                      </span>
                      {!builtIn && (
                        <>
                          <Button type="button" size="icon" variant="ghost" aria-label={`Rename ${category.name}`} onClick={() => { setEditing(category.id); setName(category.name); setParent(category.parent_id ?? ""); setRemoving(null); }}>
                            <Pencil />
                          </Button>
                          <Button type="button" size="icon" variant="ghost" aria-label={`Delete ${category.name}`} className="hover:text-danger" onClick={() => { setRemoving(category.id); setTarget(UNCATEGORISED); setEditing(null); }}>
                            <Trash2 />
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                  {removing === category.id && (
                    <div className={cn("mt-3 space-y-3 rounded-[var(--radius-control)] bg-danger-soft p-4")}>
                      <p className="text-[13px] text-ink">
                        {children > 0 ? "Move or delete its sub-categories first." : category.question_count > 0 ? `Its ${category.question_count} ${category.question_count === 1 ? "question moves" : "questions move"} to the category you choose.` : "It has no questions."}{children === 0 && " This cannot be undone."}
                      </p>
                      {children === 0 && category.question_count > 0 && (
                        <Field label="Move them to" htmlFor={`move-${category.id}`}>
                          <Select id={`move-${category.id}`} value={target} onValueChange={setTarget}>
                            {inFolderOrder(categories).filter(({ category: other }) => other.id !== category.id).map(({ category: other, label }) => (
                              <option key={other.id} value={other.id}>
                                {label}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      )}
                      <div className="flex gap-2">
                        {children === 0 && (
                          <Button type="button" size="sm" disabled={pending} className="bg-danger text-canvas hover:bg-danger/90" onClick={() => run(() => deleteCategory(category.id, target), () => setRemoving(null))}>
                            {pending && <LoaderCircle className="animate-spin" />}
                            Delete category
                          </Button>
                        )}
                        <Button type="button" size="sm" variant="ghost" onClick={() => setRemoving(null)}>
                          Keep it
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); run(async () => { const result = await createCategory(fresh, freshParent || undefined); return result.error ? { error: result.error } : { error: null, message: "Added." }; }, () => setFresh("")); }}>
            <Field label="Add a category" htmlFor="manage-new-category" className="flex-1">
              <TextInput id="manage-new-category" value={fresh} onChange={(event) => setFresh(event.target.value)} maxLength={80} placeholder="Graphs" />
            </Field>
            <Select aria-label="Inside" className="w-44" value={freshParent} onValueChange={setFreshParent}>
              <option value="">Top level</option>
              {topLevel.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
            <Button type="submit" disabled={pending || fresh.trim() === ""} className="h-10">
              Add
            </Button>
          </form>
          <FormMessage state={message} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
