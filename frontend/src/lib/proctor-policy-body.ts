import type { ProctorPolicyBody } from "@/lib/api-types";
import { VIOLATION_KINDS } from "@/lib/proctor-kinds";

/** Published policy version chosen on the exam create form; empty means use the college default. */
export function chosenPolicyVersionId(form: FormData): string {
  return String(form.get("proctor_policy_version_id") ?? "").trim();
}

/** Build a policy body from staff form fields (create / draft). */
export function policyBodyFromForm(form: FormData): ProctorPolicyBody {
  const kinds = VIOLATION_KINDS.filter((kind) => form.get(`kind_${kind}`) === "on");
  const cooldown = Number(form.get("violation_cooldown_seconds"));
  const max = Number(form.get("max_violations"));
  const body: ProctorPolicyBody = {
    enabled: form.get("enabled") === "on",
    auto_submit_on_breach: form.get("auto_submit_on_breach") === "on",
  };
  if (Number.isFinite(cooldown) && cooldown > 0) body.violation_cooldown_seconds = Math.trunc(cooldown);
  if (Number.isFinite(max) && max > 0) body.max_violations = Math.trunc(max);
  if (kinds.length > 0) body.counted_violation_kinds = kinds;
  return body;
}
