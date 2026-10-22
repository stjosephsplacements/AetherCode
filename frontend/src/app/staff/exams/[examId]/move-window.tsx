"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton, TextInput, initialActionState } from "@/components/staff/form";
import { moveWindow } from "../actions";

/** Moves one assignment's close time, for example after a lab outage (ADR-0040). */
export function MoveWindow({ examId, ruleId, closes }: { examId: string; ruleId: string; closes: string }) {
  const [state, action] = useActionState(moveWindow, initialActionState);
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="exam_id" value={examId} />
      <input type="hidden" name="rule_id" value={ruleId} />
      <TextInput name="available_until" type="datetime-local" defaultValue={closes} required aria-label="New close time" className="h-8 w-auto text-xs" />
      <SubmitButton variant="secondary" className="h-8">
        Move
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
