"use client";

import { Plus } from "@phosphor-icons/react/ssr";
import { useState } from "react";
import { ActionForm, Checkbox, Field, Select, TextArea, TextInput } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { savePlacementPost } from "./actions";

export function PlacementPostDialog({ colleges }: { colleges: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  if (colleges.length === 0) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus />
          New post
        </Button>
      </DialogTrigger>
      <DialogContent title="New post" description="Published posts appear in that college's student community." className="w-[min(94vw,760px)]">
        <div className="min-h-0 overflow-y-auto p-6">
          <ActionForm action={savePlacementPost} submitLabel="Create post" onSuccess={() => setOpen(false)}>
            <Field label="College" htmlFor="post-college">
              <Select id="post-college" name="college_id" required defaultValue={colleges[0]!.id}>
                {colleges.map((college) => (
                  <option key={college.id} value={college.id}>
                    {college.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Title" htmlFor="post-title">
              <TextInput id="post-title" name="title" maxLength={200} required autoFocus />
            </Field>
            <Field label="Body" htmlFor="post-body">
              <TextArea id="post-body" name="body_markdown" rows={12} maxLength={50000} required className="min-h-64" />
            </Field>
            <Field label="Tags" hint="Separated by commas" htmlFor="post-tags">
              <TextInput id="post-tags" name="tags" />
            </Field>
            <label className="flex items-center gap-2 text-sm text-ink">
              <Checkbox name="publish" defaultChecked />
              Published
            </label>
          </ActionForm>
        </div>
      </DialogContent>
    </Dialog>
  );
}
