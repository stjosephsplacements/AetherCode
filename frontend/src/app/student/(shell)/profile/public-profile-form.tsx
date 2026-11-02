"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { ActionForm, Field, TextArea, TextInput } from "@/components/staff/form";
import type { PublicProfile } from "@/lib/server/public-profile";
import { savePublicProfile } from "./actions";

function Check_({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-[13.5px] text-ink">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 accent-[var(--brand)]" />
      {label}
    </label>
  );
}

/** Switch the public profile on, pick its address and what it shows, and copy the link. */
export function PublicProfileForm({ profile, origin, suggestion }: { profile: PublicProfile; origin: string; suggestion: string }) {
  const [slug, setSlug] = useState(profile.slug || suggestion);
  const [copied, setCopied] = useState(false);
  const url = `${origin}/u/${slug.toLowerCase()}`;
  const content = profile.content;
  return (
    <div className="border border-ink bg-surface p-5 shadow-[4px_4px_0_var(--ink)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-mono text-[13px] text-ink-muted">[ public profile ]</h2>
        <span className={`font-mono text-[12px] ${profile.enabled ? "text-success" : "text-ink-subtle"}`}>{profile.enabled ? "● public" : "○ hidden"}</span>
      </div>
      <p className="mb-4 max-w-[62ch] text-[14px] text-ink-muted">A card anyone can open without signing in, to share with recruiters and friends. It shows only what you tick below, and you can hide it again at any time.</p>
      <ActionForm action={savePublicProfile} submitLabel="Save profile">
        <Check_ name="enabled" label="Make my profile public" defaultChecked={profile.enabled} />
        <Field label="Address" hint="3 to 31 lowercase letters, digits or dashes" htmlFor="public-slug">
          <TextInput id="public-slug" name="slug" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} pattern="[a-z0-9][a-z0-9\-]{2,30}" required />
        </Field>
        <div className="flex flex-wrap items-center gap-2 border border-line bg-canvas px-3 py-2 font-mono text-[12.5px] text-ink-muted">
          <span className="min-w-0 flex-1 truncate">{url}</span>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}
            className="inline-flex items-center gap-1.5 text-ink hover:text-brand"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "copied" : "copy"}
          </button>
          {profile.enabled && (
            <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-ink hover:text-brand">
              <ExternalLink className="size-3.5" />
              open
            </a>
          )}
        </div>
        <Field label="Headline" htmlFor="public-headline">
          <TextInput id="public-headline" name="headline" defaultValue={content.headline ?? ""} maxLength={120} placeholder="Final-year CSE, backend and systems" />
        </Field>
        <Field label="About you" htmlFor="public-bio">
          <TextArea id="public-bio" name="bio" defaultValue={content.bio ?? ""} maxLength={600} rows={3} />
        </Field>
        <Field label="Skills" hint="Separated by commas" htmlFor="public-skills">
          <TextInput id="public-skills" name="skills" defaultValue={(content.skills ?? []).join(", ")} placeholder="Go, Python, SQL" />
        </Field>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Check_ name="show_college" label="Show my college" defaultChecked={Boolean(content.college) || !profile.slug} />
          <Check_ name="show_links" label="Show my linked coding accounts" defaultChecked={(content.links ?? []).length > 0 || !profile.slug} />
        </div>
      </ActionForm>
    </div>
  );
}
