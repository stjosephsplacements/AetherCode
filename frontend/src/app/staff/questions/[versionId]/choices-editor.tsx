"use client";

import { useState, useTransition } from "react";
import { FormMessage, initialActionState, type ActionState } from "@/components/staff/form";
import { ChoicesFields, blankChoices } from "@/components/staff/question-wizard/choices-fields";
import { type Choices, choicesProblem } from "@/components/staff/question-wizard/model";
import { Button } from "@/components/ui/button";
import { saveChoices } from "../actions";

/** Options and answer of a saved multiple-choice draft (ADR-0035). */
export function ChoicesEditor({
  versionId,
  expectedVersion,
  initial,
}: {
  versionId: string;
  expectedVersion: number;
  initial: { choices: string[]; correct: number[]; multiple: boolean };
}) {
  const [value, setValue] = useState<Choices>(() => (initial.choices.length >= 2 ? { options: initial.choices, correct: initial.correct, multiple: initial.multiple } : blankChoices()));
  const [state, setState] = useState<ActionState>(initialActionState);
  const [saving, startSaving] = useTransition();

  return (
    <div className="space-y-4">
      <ChoicesFields value={value} onChange={(next) => { setValue(next); setState(initialActionState); }} />
      <FormMessage state={state} />
      <Button type="button" disabled={saving || choicesProblem(value) !== null} onClick={() => startSaving(async () => setState(await saveChoices(versionId, expectedVersion, value.options, value.correct, value.multiple)))}>
        {saving ? "Saving" : "Save options"}
      </Button>
    </div>
  );
}
