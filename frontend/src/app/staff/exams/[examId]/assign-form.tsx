"use client";

import { useState } from "react";
import { ActionForm, Field, Select, TextInput } from "@/components/staff/form";
import { assignExam } from "../actions";

type Option = { id: string; label: string };

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
  const labels = { batch: "Batch", department: "College department", placement_department: "Placement department" };
  return (
    <ActionForm action={assignExam} submitLabel="Assign exam">
      <input type="hidden" name="exam_id" value={examId} />
      <input type="hidden" name="version_id" value={versionId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Assign to" htmlFor="assign-type">
          <Select id="assign-type" name="target_type" value={type} onChange={(event) => setType(event.target.value as keyof typeof targets)}>
            {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => (
              <option key={key} value={key} disabled={targets[key].length === 0}>
                {labels[key]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels[type]} htmlFor="assign-target">
          <Select id="assign-target" name={`target_${type}`} required>
            {targets[type].map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Available from" htmlFor="assign-from">
          <TextInput id="assign-from" name="available_from" type="datetime-local" defaultValue={opens} required />
        </Field>
        <Field label="Available until" htmlFor="assign-until">
          <TextInput id="assign-until" name="available_until" type="datetime-local" defaultValue={closes} required />
        </Field>
      </div>
    </ActionForm>
  );
}
