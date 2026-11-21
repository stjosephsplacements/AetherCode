"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/staff/form";
import type { ProctorPolicy, ProctorPolicyVersion } from "@/lib/api-types";
import { policyBodyFromForm } from "@/lib/proctor-policy-body";
import { actionError } from "@/lib/server/actions";
import { gateway } from "@/lib/server/gateway";
import { assessmentBase } from "@/lib/server/proctor-policies";
import { requireCollege } from "@/lib/server/staff";

function revalidatePolicyList(policyId: string) {
  revalidatePath(`/staff/proctor-policies/${policyId}`);
  revalidatePath("/staff/proctor-policies");
}

async function publishIfRequested(tenantId: string, versionId: string, form: FormData) {
  if (form.get("publish") !== "on") return;
  await gateway(`${assessmentBase(tenantId)}/proctor-policy-versions/${versionId}/publish`, { method: "POST", body: {} });
}

export async function createPolicy(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { error: "Name a policy." };
  let policyId: string;
  try {
    const policy = await gateway<ProctorPolicy>(`${assessmentBase(tenantId)}/proctor-policies`, {
      method: "POST",
      body: { name },
    });
    const version = await gateway<ProctorPolicyVersion>(`${assessmentBase(tenantId)}/proctor-policies/${policy.id}/versions`, {
      method: "POST",
      body: { expected_policy_version: policy.version, policy: policyBodyFromForm(form) },
    });
    policyId = policy.id;
    await publishIfRequested(tenantId, version.id, form);
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/proctor-policies");
  redirect(`/staff/proctor-policies/${policyId}`);
}

export async function addDraftVersion(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  const policyId = String(form.get("policy_id") ?? "");
  const expected = Number(form.get("expected_policy_version"));
  try {
    const version = await gateway<ProctorPolicyVersion>(`${assessmentBase(tenantId)}/proctor-policies/${policyId}/versions`, {
      method: "POST",
      body: { expected_policy_version: expected, policy: policyBodyFromForm(form) },
    });
    await publishIfRequested(tenantId, version.id, form);
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePolicyList(policyId);
  return { error: null, message: "Draft saved." };
}

export async function publishVersion(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  const policyId = String(form.get("policy_id") ?? "");
  const versionId = String(form.get("version_id") ?? "");
  try {
    await gateway(`${assessmentBase(tenantId)}/proctor-policy-versions/${versionId}/publish`, { method: "POST", body: {} });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePolicyList(policyId);
  return { error: null, message: "Published." };
}
