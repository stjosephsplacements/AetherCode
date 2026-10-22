"use client";

import { Upload } from "lucide-react";
import { useActionState } from "react";
import { FormMessage, SubmitButton, initialActionState } from "@/components/staff/form";
import { importQuestion } from "./actions";

/** Import a question file another college exported (ADR-0032), or an exam-app (v1) question file. */
export function ImportQuestionForm() {
  const [state, action] = useActionState(importQuestion, initialActionState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input
        type="file"
        name="file"
        accept=".json,application/json"
        required
        aria-label="Exported question file"
        className="text-sm text-ink-muted file:mr-3 file:rounded-[var(--radius-control)] file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink"
      />
      <SubmitButton variant="secondary">
        <Upload />
        Import as draft
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
