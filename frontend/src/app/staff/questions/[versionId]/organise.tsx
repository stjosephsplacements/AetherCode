"use client";

import { Check, CircleNotch } from "@phosphor-icons/react/ssr";
import { useState, useTransition } from "react";
import { CategoryPicker } from "@/components/staff/category-picker";
import { Field, FormMessage, type ActionState } from "@/components/staff/form";
import { TagInput, type TagSuggestion } from "@/components/staff/tag-input";
import { cleanTags } from "@/components/staff/question-wizard/model";
import { Button } from "@/components/ui/button";
import type { CategoryRef } from "@/lib/api-types";
import { saveOrganisation } from "../actions";

/**
 * Where a question is filed and how it is described. These belong to the question,
 * not a version, so they change on a published question without a new version (ADR-0052).
 */
export function Organise({
  questionId,
  versionId,
  categories: initialCategories,
  tagSuggestions,
  initial,
}: {
  questionId: string;
  versionId: string;
  categories: CategoryRef[];
  tagSuggestions: TagSuggestion[];
  initial: { categoryId: string; tags: string[] };
}) {
  const [categories, setCategories] = useState(initialCategories);
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [tags, setTags] = useState(initial.tags);
  const [state, setState] = useState<ActionState>({ error: null });
  const [saving, startSaving] = useTransition();
  const changed = categoryId !== initial.categoryId || cleanTags(tags).join("\n") !== cleanTags(initial.tags).join("\n");

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
      <Field label="Category" htmlFor="organise-category">
        <CategoryPicker
          id="organise-category"
          categories={categories}
          value={categoryId}
          onChange={(id) => { setCategoryId(id); setState({ error: null }); }}
          onCreated={(category) => setCategories((list) => [...list.filter((entry) => entry.id !== category.id), category])}
        />
      </Field>
      <Field label="Tags" htmlFor="organise-tags">
        <TagInput id="organise-tags" value={tags} onChange={(next) => { setTags(next); setState({ error: null }); }} suggestions={tagSuggestions} />
      </Field>
      <div className="flex items-center gap-3 lg:pt-[26px]">
        <Button type="button" disabled={saving || !changed || !categoryId} onClick={() => startSaving(async () => setState(await saveOrganisation(questionId, versionId, categoryId, tags)))}>
          {saving ? <CircleNotch className="animate-spin" /> : <Check />}
          Save
        </Button>
      </div>
      <div className="lg:col-span-3">
        <FormMessage state={state} />
      </div>
    </div>
  );
}
