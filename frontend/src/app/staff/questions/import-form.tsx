"use client";

import { UploadSimple } from "@phosphor-icons/react/ssr";
import { useActionState } from "react";
import { FileInput, FormMessage, SubmitButton, initialActionState } from "@/components/staff/form";
import { importQuestion } from "./actions";

/** Import a question file another college exported (ADR-0032), or an exam-app (v1) question file. */
export function ImportQuestionForm() {
  const [state, action] = useActionState(importQuestion, initialActionState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <FileInput name="file" accept=".json,application/json" required aria-label="Exported question file" />
      <SubmitButton variant="secondary">
        <UploadSimple />
        Import as draft
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
