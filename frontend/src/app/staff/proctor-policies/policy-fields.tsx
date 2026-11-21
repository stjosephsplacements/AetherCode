import { Checkbox, Field, TextInput } from "@/components/staff/form";
import type { ProctorPolicyBody } from "@/lib/api-types";
import { normalizeCountedKinds, POLICY_KIND_OPTIONS } from "@/lib/proctor-kinds";

export function PolicyKindChecks({ selected = [] }: { selected?: readonly string[] }) {
  const chosen = new Set(normalizeCountedKinds(selected));
  return (
    <Field label="Counted kinds" htmlFor="policy-kinds" hint="Leave all unchecked to count every kind.">
      <div id="policy-kinds" className="grid gap-2 sm:grid-cols-2">
        {POLICY_KIND_OPTIONS.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm text-ink">
            <Checkbox name={`kind_${option.value}`} defaultChecked={chosen.has(option.value)} />
            {option.label}
          </label>
        ))}
      </div>
    </Field>
  );
}

/** Shared cooldown / max / toggles for create and draft forms. */
export function PolicyBodyFields({
  idPrefix,
  seed = {},
  publishDefaultChecked = false,
  publishLabel,
}: {
  idPrefix: string;
  seed?: ProctorPolicyBody;
  publishDefaultChecked?: boolean;
  publishLabel: string;
}) {
  return (
    <>
      <PolicyKindChecks selected={seed.counted_violation_kinds ?? []} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cooldown (seconds)" htmlFor={`${idPrefix}-cooldown`} hint="Minimum gap between counts of the same kind.">
          <TextInput
            id={`${idPrefix}-cooldown`}
            name="violation_cooldown_seconds"
            type="number"
            min={1}
            max={3600}
            defaultValue={seed.violation_cooldown_seconds ?? 30}
          />
        </Field>
        <Field label="Max violations" htmlFor={`${idPrefix}-max`} hint="Required for auto-submit.">
          <TextInput
            id={`${idPrefix}-max`}
            name="max_violations"
            type="number"
            min={1}
            max={1000}
            defaultValue={seed.max_violations ?? 5}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <Checkbox name="enabled" defaultChecked={seed.enabled === true} />
        Count violations for this exam
      </label>
      <label className="flex items-center gap-2 text-sm text-ink">
        <Checkbox name="auto_submit_on_breach" defaultChecked={seed.auto_submit_on_breach === true} />
        Auto-submit when the max is reached
      </label>
      <label className="flex items-center gap-2 text-sm text-ink">
        <Checkbox name="publish" defaultChecked={publishDefaultChecked} />
        {publishLabel}
      </label>
    </>
  );
}
