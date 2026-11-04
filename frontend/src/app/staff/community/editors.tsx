"use client";

import { PencilSimple, Plus } from "@phosphor-icons/react/ssr";
import { useState } from "react";
import { ActionForm, Checkbox, Field, Select, TextArea, TextInput } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { CommunityPost, FeedItem } from "@/lib/api-types";
import { isoToCollegeTime } from "@/lib/utils";
import { savePost, saveListing } from "./actions";

type College = { id: string; name: string };

/** Where a new item goes: a root admin picks the college, everyone else saves into their own. */
function CollegeField({ colleges, college, id }: { colleges?: College[]; college?: string; id: string }) {
  if (college) return <input type="hidden" name="college_id" value={college} />;
  if (!colleges || colleges.length === 0) return null;
  return (
    <Field label="College" htmlFor={id} hint="Students of this college see it.">
      <Select id={id} name="college_id" required defaultValue={colleges[0]!.id}>
        {colleges.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

const trigger = (editing: boolean, label: string) =>
  editing ? (
    <Button type="button" variant="ghost" size="sm">
      <PencilSimple />
      Edit
    </Button>
  ) : (
    <Button type="button">
      <Plus />
      {label}
    </Button>
  );

/** Write or edit a blog post in a dialog; it closes when the post is saved. */
export function PostDialog({ post, college, colleges }: { post?: CommunityPost; college?: string; colleges?: College[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger(!!post, "New post")}</DialogTrigger>
      <DialogContent title={post ? "Edit post" : "New post"} description="Markdown. Students see it once it is published." className="w-[min(94vw,760px)]">
        <div className="min-h-0 overflow-y-auto p-6">
          <ActionForm action={savePost} submitLabel={post ? "Save post" : "Create post"} onSuccess={() => setOpen(false)}>
            {post && <input type="hidden" name="id" value={post.id} />}
            <CollegeField colleges={colleges} college={college} id="post-college" />
            <Field label="Title" htmlFor="post-title">
              <TextInput id="post-title" name="title" defaultValue={post?.title} maxLength={200} required autoFocus />
            </Field>
            <Field label="Body" htmlFor="post-body">
              <TextArea id="post-body" name="body_markdown" rows={12} defaultValue={post?.body_markdown} maxLength={50000} required className="min-h-64" />
            </Field>
            <Field label="Tags" hint="Separated by commas" htmlFor="post-tags">
              <TextInput id="post-tags" name="tags" defaultValue={post?.tags.join(", ")} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-ink">
              <Checkbox name="publish" defaultChecked={post?.status === "published"} />
              Published
            </label>
          </ActionForm>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Add or edit a contest, hackathon or open-source listing in a dialog. */
export function ListingDialog({ item, college, colleges }: { item?: FeedItem; college?: string; colleges?: College[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger(!!item, "Add a listing")}</DialogTrigger>
      <DialogContent title={item ? "Edit listing" : "Add a listing"} description="Students find it under Contests, Hackathons or Open source." className="w-[min(94vw,720px)]">
        <div className="min-h-0 overflow-y-auto p-6">
          <ActionForm action={saveListing} submitLabel={item ? "Save listing" : "Add listing"} onSuccess={() => setOpen(false)}>
            {item && <input type="hidden" name="id" value={item.id} />}
            <CollegeField colleges={colleges} college={college} id="listing-college" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type" htmlFor="listing-kind">
                <Select id="listing-kind" name="kind" defaultValue={item?.kind ?? "contest"}>
                  <option value="contest">Contest</option>
                  <option value="hackathon">Hackathon</option>
                  <option value="opensource">Open source</option>
                </Select>
              </Field>
              <Field label="Platform" htmlFor="listing-platform">
                <TextInput id="listing-platform" name="platform" defaultValue={item?.platform ?? ""} maxLength={100} placeholder="Codeforces, Devfolio, GitHub" />
              </Field>
              <Field label="Title" htmlFor="listing-title" className="sm:col-span-2">
                <TextInput id="listing-title" name="title" defaultValue={item?.title} maxLength={300} required autoFocus />
              </Field>
              <Field label="Link" htmlFor="listing-url" className="sm:col-span-2">
                <TextInput id="listing-url" name="url" type="url" defaultValue={item?.url} placeholder="https://" required />
              </Field>
              <Field label="Starts (optional)" htmlFor="listing-starts">
                <TextInput id="listing-starts" name="starts_at" type="datetime-local" defaultValue={item?.starts_at ? isoToCollegeTime(item.starts_at) : ""} />
              </Field>
              <Field label="Ends (optional)" htmlFor="listing-ends">
                <TextInput id="listing-ends" name="ends_at" type="datetime-local" defaultValue={item?.ends_at ? isoToCollegeTime(item.ends_at) : ""} />
              </Field>
              <Field label="Description (optional)" htmlFor="listing-description" className="sm:col-span-2">
                <TextArea id="listing-description" name="description" rows={3} defaultValue={item?.description ?? ""} maxLength={4000} />
              </Field>
              <Field label="Tags" hint="Separated by commas" htmlFor="listing-tags" className="sm:col-span-2">
                <TextInput id="listing-tags" name="tags" defaultValue={item?.tags.join(", ")} />
              </Field>
            </div>
          </ActionForm>
        </div>
      </DialogContent>
    </Dialog>
  );
}
