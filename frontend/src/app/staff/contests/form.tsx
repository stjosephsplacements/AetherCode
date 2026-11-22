"use client";

import { useMemo, useState } from "react";
import { Checkbox, TextArea, TextInput } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createContest } from "./actions";

export type ContestQuestionOption = {
  id: string;
  title: string;
  kind?: string;
  tags: string[];
};

export function CreateContestForm({ collegeId, questions }: { collegeId: string; questions: ContestQuestionOption[] }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const questionIds = useMemo(() => [...selected].join(","), [selected]);
  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <form className="grid gap-3 rounded-lg border border-line p-4 md:grid-cols-2" action={createContest.bind(null, collegeId)}>
      <TextInput name="title" placeholder="Title" required className="md:col-span-2" />
      <input type="hidden" name="question_ids" value={questionIds} />
      <fieldset className="md:col-span-2 space-y-2">
        <legend className="text-sm font-medium text-ink">Practice problems</legend>
        {questions.length === 0 ? (
          <p className="text-sm text-ink-muted">No practice problems in the catalogue yet.</p>
        ) : (
          <ul className="max-h-64 space-y-2 overflow-y-auto rounded border border-line p-2">
            {questions.map((question) => {
              const checked = selected.has(question.id);
              return (
                <li key={question.id}>
                  <label className={cn("flex cursor-pointer items-start gap-3 rounded p-2 text-sm hover:bg-canvas", checked && "bg-canvas")}>
                    <Checkbox checked={checked} onCheckedChange={() => toggle(question.id)} aria-label={question.title} />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-ink">{question.title}</span>
                      <span className="mt-0.5 block text-xs text-ink-muted">
                        {question.kind ?? "coding"}
                        {question.tags.length ? ` · ${question.tags.join(", ")}` : ""}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>
      <TextInput name="starts_at" type="datetime-local" required />
      <TextInput name="ends_at" type="datetime-local" required />
      <TextArea name="description" placeholder="Description" className="md:col-span-2" rows={3} />
      <div className="md:col-span-2">
        <Button type="submit" disabled={selected.size === 0}>
          Create contest
        </Button>
      </div>
    </form>
  );
}