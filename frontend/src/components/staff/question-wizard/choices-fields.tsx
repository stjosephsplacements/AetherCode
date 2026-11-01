"use client";

import { Plus, X } from "lucide-react";
import { Checkbox, TextInput } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { type Choices, choicesProblem } from "./model";

export const MAX_OPTIONS = 10;

/** A fresh set of options for a new question. */
export const blankChoices = (): Choices => ({ options: ["", "", "", ""], correct: [], multiple: false });

/**
 * Options and answer of a multiple-choice question (ADR-0035). Students get the
 * options shuffled; marks are all-or-nothing: the selection must be exactly the
 * correct set. Controlled, so the wizard and the draft editor share it.
 */
export function ChoicesFields({ value, onChange }: { value: Choices; onChange: (value: Choices) => void }) {
  const { options, correct, multiple } = value;
  const problem = choicesProblem(value);

  const toggle = (index: number) =>
    onChange({
      ...value,
      correct: multiple ? (correct.includes(index) ? correct.filter((entry) => entry !== index) : [...correct, index].sort((a, b) => a - b)) : [index],
    });
  const remove = (index: number) =>
    onChange({ ...value, options: options.filter((_, position) => position !== index), correct: correct.filter((entry) => entry !== index).map((entry) => (entry > index ? entry - 1 : entry)) });

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm text-ink">
        <Checkbox checked={multiple} onCheckedChange={(checked) => onChange({ ...value, multiple: checked === true, correct: checked === true ? correct : correct.slice(0, 1) })} />
        More than one option is correct
      </label>
      <ol className="space-y-2">
        {options.map((option, index) => (
          <li key={index} className="flex items-center gap-3">
            {/* One correct option reads as a radio: round. */}
            <Checkbox checked={correct.includes(index)} onCheckedChange={() => toggle(index)} aria-label={`Option ${index + 1} is correct`} className={multiple ? undefined : "rounded-full"} />
            <TextInput
              value={option}
              onChange={(event) => onChange({ ...value, options: options.map((entry, position) => (position === index ? event.target.value : entry)) })}
              placeholder={`Option ${index + 1}`}
              maxLength={2000}
              aria-label={`Option ${index + 1}`}
              className="h-9 flex-1"
            />
            {options.length > 2 && (
              <button
                type="button"
                onClick={() => remove(index)}
                aria-label={`Remove option ${index + 1}`}
                className="grid size-8 place-items-center rounded-[var(--radius-control)] text-ink-muted transition-colors hover:bg-hover hover:text-ink"
              >
                <X className="size-4" strokeWidth={1.75} />
              </button>
            )}
          </li>
        ))}
      </ol>
      {options.length < MAX_OPTIONS && (
        <Button type="button" variant="secondary" size="sm" onClick={() => onChange({ ...value, options: [...options, ""] })}>
          <Plus />
          Add option
        </Button>
      )}
      <p className="text-xs text-ink-muted" role="status">
        {problem ?? `Mark the correct ${multiple ? "options" : "option"}. Students see the options in a shuffled order and score the marks only for exactly the correct set.`}
      </p>
    </div>
  );
}
