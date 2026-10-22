"use client";

import { Plus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { FormMessage, initialActionState, type ActionState } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { saveChoices } from "../actions";

/**
 * Options and answer of a multiple-choice question (ADR-0035). Students get
 * the options shuffled; marks are all-or-nothing: the selection must be exactly
 * the correct set.
 */
export function ChoicesEditor({
  versionId,
  expectedVersion,
  initial,
}: {
  versionId: string;
  expectedVersion: number;
  initial: { choices: string[]; correct: number[]; multiple: boolean };
}) {
  const [choices, setChoices] = useState(initial.choices.length >= 2 ? initial.choices : ["", "", "", ""]);
  const [correct, setCorrect] = useState<number[]>(initial.correct);
  const [multiple, setMultiple] = useState(initial.multiple);
  const [state, setState] = useState<ActionState>(initialActionState);
  const [saving, startSaving] = useTransition();

  function toggle(index: number) {
    setCorrect((current) =>
      multiple ? (current.includes(index) ? current.filter((value) => value !== index) : [...current, index].sort((a, b) => a - b)) : [index],
    );
  }
  function remove(index: number) {
    setChoices((current) => current.filter((_, position) => position !== index));
    setCorrect((current) => current.filter((value) => value !== index).map((value) => (value > index ? value - 1 : value)));
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={multiple}
          onChange={(event) => {
            setMultiple(event.target.checked);
            if (!event.target.checked) setCorrect((current) => current.slice(0, 1));
          }}
          className="accent-[var(--brand)]"
        />
        More than one option is correct
      </label>
      <ol className="space-y-2">
        {choices.map((choice, index) => (
          <li key={index} className="flex items-center gap-2">
            <input
              type={multiple ? "checkbox" : "radio"}
              name="correct"
              checked={correct.includes(index)}
              onChange={() => toggle(index)}
              aria-label={`Option ${index + 1} is correct`}
              className="accent-[var(--brand)]"
            />
            <input
              value={choice}
              onChange={(event) => setChoices((current) => current.map((value, position) => (position === index ? event.target.value : value)))}
              placeholder={`Option ${index + 1}`}
              maxLength={2000}
              className="h-9 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand"
            />
            {choices.length > 2 && (
              <button type="button" onClick={() => remove(index)} aria-label={`Remove option ${index + 1}`} className="rounded p-1 text-ink-muted hover:bg-hover hover:text-ink">
                <X className="size-4" strokeWidth={1.75} />
              </button>
            )}
          </li>
        ))}
      </ol>
      {choices.length < 10 && (
        <Button type="button" variant="secondary" size="sm" onClick={() => setChoices((current) => [...current, ""])}>
          <Plus />
          Add option
        </Button>
      )}
      <p className="text-xs text-ink-muted">Mark the correct {multiple ? "options" : "option"}. Students see the options in a shuffled order and score the marks only for exactly the correct set.</p>
      <FormMessage state={state} />
      <Button type="button" disabled={saving} onClick={() => startSaving(async () => setState(await saveChoices(versionId, expectedVersion, choices, correct, multiple)))}>
        {saving ? "Saving" : "Save options"}
      </Button>
    </div>
  );
}
