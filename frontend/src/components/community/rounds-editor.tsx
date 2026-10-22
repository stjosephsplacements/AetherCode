"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Field, TextArea, TextInput } from "@/components/staff/form";
import { Button } from "@/components/ui/button";

/** Interview rounds as numbered fields: round_title_0, round_description_0, round_title_1 … */
export function RoundsEditor() {
  const [keys, setKeys] = useState([0]);
  const [next, setNext] = useState(1);
  return (
    <div className="space-y-4">
      {keys.map((key, position) => (
        <div key={key} className="rounded-[var(--radius-control)] border border-line p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-medium text-ink">Round {position + 1}</span>
            {keys.length > 1 && (
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove round ${position + 1}`} onClick={() => setKeys(keys.filter((other) => other !== key))}>
                <Trash2 />
              </Button>
            )}
          </div>
          {/* The server reads the fields in the order of their index, so a removed round leaves a gap-free numbering. */}
          <Field label="Title" htmlFor={`round-title-${key}`}>
            <TextInput id={`round-title-${key}`} name={`round_title_${position}`} placeholder="Online test, technical interview, HR" maxLength={200} required />
          </Field>
          <Field label="What happened" htmlFor={`round-description-${key}`} className="mt-3">
            <TextArea id={`round-description-${key}`} name={`round_description_${position}`} rows={3} maxLength={4000} />
          </Field>
        </div>
      ))}
      {keys.length < 15 && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            setKeys([...keys, next]);
            setNext(next + 1);
          }}
        >
          <Plus />
          Add a round
        </Button>
      )}
    </div>
  );
}
