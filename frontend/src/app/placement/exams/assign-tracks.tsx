"use client";

import { Check } from "@phosphor-icons/react/ssr";
import { useState } from "react";
import { ActionForm, Field, TextInput } from "@/components/staff/form";
import { cn } from "@/lib/utils";
import { assignPlacementTracks } from "./actions";

type Option = { id: string; label: string };

/** Assign an exam only to the officer's placement departments. */
export function AssignTracks({
  collegeId,
  examId,
  versionId,
  opens,
  closes,
  tracks,
}: {
  collegeId: string;
  examId: string;
  versionId: string;
  opens: string;
  closes: string;
  tracks: Option[];
}) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(tracks.map((track) => track.id)));
  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ActionForm action={assignPlacementTracks} submitLabel={chosen.size ? `Assign to ${chosen.size} track${chosen.size === 1 ? "" : "s"}` : "Assign"}>
      <input type="hidden" name="college_id" value={collegeId} />
      <input type="hidden" name="exam_id" value={examId} />
      <input type="hidden" name="version_id" value={versionId} />
      {[...chosen].map((id) => (
        <span key={id}>
          <input type="hidden" name="target_id" value={id} />
          <input type="hidden" name={`label_${id}`} value={tracks.find((track) => track.id === id)?.label ?? ""} />
        </span>
      ))}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Available from" htmlFor="assign-from">
          <TextInput id="assign-from" name="available_from" type="datetime-local" defaultValue={opens} required />
        </Field>
        <Field label="Available until" htmlFor="assign-until">
          <TextInput id="assign-until" name="available_until" type="datetime-local" defaultValue={closes} required />
        </Field>
      </div>
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-control border border-line">
        {tracks.map((track) => {
          const on = chosen.has(track.id);
          return (
            <li key={track.id}>
              <button
                type="button"
                onClick={() => toggle(track.id)}
                className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left text-[13.5px] transition-colors hover:bg-hover", on && "bg-brand-soft/40")}
              >
                <span className={cn("grid size-4 shrink-0 place-items-center rounded-sm border", on ? "border-brand bg-brand text-white" : "border-line-strong")}>
                  {on && <Check className="size-3" weight="bold" />}
                </span>
                <span className="font-medium text-ink">{track.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </ActionForm>
  );
}
