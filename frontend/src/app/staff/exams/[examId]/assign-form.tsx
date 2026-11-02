"use client";

import { Check, Search } from "lucide-react";
import { useState } from "react";
import { ActionForm, Field, Select, TextInput } from "@/components/staff/form";
import { cn } from "@/lib/utils";
import { assignExam } from "../actions";

type Option = { id: string; label: string };

/**
 * Assign one exam to as many batches (or departments) as you choose, in one go: tick them, or take
 * everything with Select all. The window is the same for all of them.
 */
export function AssignForm({
  examId,
  versionId,
  opens,
  closes,
  targets,
}: {
  examId: string;
  versionId: string;
  opens: string;
  closes: string;
  targets: { batch: Option[]; department: Option[]; placement_department: Option[] };
}) {
  const [type, setType] = useState<keyof typeof targets>("batch");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const labels = { batch: "Batches", department: "College departments", placement_department: "Placement departments" };
  const options = targets[type];
  const shown = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allShown = shown.length > 0 && shown.every((option) => chosen.has(option.id));

  return (
    <ActionForm action={assignExam} submitLabel={chosen.size ? `Assign to ${chosen.size} selected` : "Assign exam"} onSuccess={() => setChosen(new Set())}>
      <input type="hidden" name="exam_id" value={examId} />
      <input type="hidden" name="version_id" value={versionId} />
      <input type="hidden" name="target_type" value={type} />
      {[...chosen].map((id) => (
        <span key={id}>
          <input type="hidden" name="target_id" value={id} />
          <input type="hidden" name={`label_${id}`} value={options.find((option) => option.id === id)?.label ?? ""} />
        </span>
      ))}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Assign to" htmlFor="assign-type">
          <Select
            id="assign-type"
            value={type}
            onValueChange={(value) => {
              setType(value as keyof typeof targets);
              setChosen(new Set());
              setQuery("");
            }}
          >
            {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => (
              <option key={key} value={key} disabled={targets[key].length === 0}>
                {labels[key]}
              </option>
            ))}
          </Select>
        </Field>
        <div />
        <Field label="Available from" htmlFor="assign-from">
          <TextInput id="assign-from" name="available_from" type="datetime-local" defaultValue={opens} required />
        </Field>
        <Field label="Available until" htmlFor="assign-until">
          <TextInput id="assign-until" name="available_until" type="datetime-local" defaultValue={closes} required />
        </Field>
      </div>

      <div className="mt-2">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-ink">
            {labels[type]} <span className="font-mono text-xs font-normal text-ink-subtle">{chosen.size} of {options.length} selected</span>
          </p>
          <div className="flex items-center gap-2">
            <label className="relative">
              <span className="sr-only">Search</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-subtle" strokeWidth={1.75} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" className="h-8 w-40 rounded-full border border-line bg-surface pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand" />
            </label>
            <button
              type="button"
              onClick={() =>
                setChosen((current) => {
                  const next = new Set(current);
                  for (const option of shown) {
                    if (allShown) next.delete(option.id);
                    else next.add(option.id);
                  }
                  return next;
                })
              }
              className="rounded-full bg-hover px-3 py-1 text-[12.5px] font-medium text-ink-muted transition-colors hover:text-ink"
            >
              {allShown ? "Clear" : "Select all"}
            </button>
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-muted">Nothing matches.</p>
        ) : (
          <ul className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3" role="group" aria-label={labels[type]}>
            {shown.map((option) => {
              const on = chosen.has(option.id);
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(option.id)}
                    className={cn("flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-[13.5px] transition-colors", on ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line text-ink hover:border-line-strong hover:bg-hover")}
                  >
                    <span className={cn("grid size-4 shrink-0 place-items-center rounded border", on ? "border-brand bg-brand text-brand-ink" : "border-line-strong")}>{on && <Check className="size-3" strokeWidth={3} />}</span>
                    <span className="min-w-0 truncate">{option.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ActionForm>
  );
}
