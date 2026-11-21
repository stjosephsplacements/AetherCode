import Link from "next/link";
import { Field, Select } from "@/components/staff/form";

export type PublishedPolicyOption = { id: string; label: string };

/** Shared policy picker for /staff/exams/new and the New exam dialog. */
export function ExamPolicyField({ policies }: { policies: PublishedPolicyOption[] }) {
  const requireChoice = policies.length > 0;
  return (
    <>
      <Field
        label="Proctor policy"
        htmlFor="exam-policy"
        hint={
          requireChoice
            ? undefined
            : "None published yet — a Standard policy will be created. Configure rules under Proctor policies."
        }
      >
        <Select
          id="exam-policy"
          name="proctor_policy_version_id"
          defaultValue={requireChoice ? policies[0]!.id : ""}
          required={requireChoice}
        >
          {requireChoice ? null : <option value="">Create Standard policy</option>}
          {policies.map((policy) => (
            <option key={policy.id} value={policy.id}>
              {policy.label}
            </option>
          ))}
        </Select>
      </Field>
      <p className="text-xs text-ink-muted">
        <Link href="/staff/proctor-policies" className="text-brand hover:underline">
          Manage proctor policies
        </Link>
      </p>
    </>
  );
}
