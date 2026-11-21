import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff/form";
import { LoadError, PageHeader, Section } from "@/components/staff/page-header";
import { Badge, Panel } from "@/components/ui/card";
import type { ProctorPolicy, ProctorPolicyVersion } from "@/lib/api-types";
import { violationKindLabel } from "@/lib/proctor-kinds";
import { GatewayError, gateway } from "@/lib/server/gateway";
import { listProctorPolicyVersions } from "@/lib/server/proctor-policies";
import { requireCollege } from "@/lib/server/staff";
import { addDraftVersion, publishVersion } from "../actions";
import { PolicyBodyFields } from "../policy-fields";

export const metadata: Metadata = { title: "Proctor policy" };

const VERSION_TONE: Record<ProctorPolicyVersion["status"], "success" | "warning" | "neutral"> = {
  published: "success",
  draft: "warning",
  retired: "neutral",
};

function summarize(policy: ProctorPolicyVersion["policy"]): string {
  const parts: string[] = [];
  parts.push(policy.enabled ? "Counting on" : "Counting off");
  if (policy.violation_cooldown_seconds) parts.push(`${policy.violation_cooldown_seconds}s cooldown`);
  if (policy.max_violations) parts.push(`max ${policy.max_violations}`);
  if (policy.auto_submit_on_breach) parts.push("auto-submit");
  if (policy.counted_violation_kinds?.length) {
    parts.push(policy.counted_violation_kinds.map((kind) => violationKindLabel(kind, "short") ?? kind).join(", "));
  } else {
    parts.push("all kinds");
  }
  return parts.join(" · ");
}

export default async function ProctorPolicyDetailPage({ params }: { params: Promise<{ policyId: string }> }) {
  const { tenantId } = await requireCollege();
  const { policyId } = await params;
  let policy: ProctorPolicy;
  let versions: ProctorPolicyVersion[];
  try {
    [policy, versions] = await Promise.all([
      gateway<ProctorPolicy>(`/assessment/v1/tenants/${tenantId}/proctor-policies/${policyId}`),
      listProctorPolicyVersions(tenantId, policyId),
    ]);
  } catch (error) {
    if (error instanceof GatewayError && error.status === 404) notFound();
    return (
      <>
        <PageHeader title="Proctor policy" />
        <LoadError error={error} />
      </>
    );
  }

  const draftSeed = versions[0]?.policy ?? {};

  return (
    <>
      <Link href="/staff/proctor-policies" className="mb-6 inline-block text-sm text-ink-muted hover:text-ink">
        ← Proctor policies
      </Link>
      <PageHeader title={policy.name} description="Draft a new version, then publish it before attaching it to an exam." />
      <Section title="Versions">
        <ul className="space-y-2">
          {versions.map((version) => (
            <li key={version.id}>
              <Panel className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <div>
                  <p className="font-medium text-ink">
                    Version {version.version_number}{" "}
                    <Badge tone={VERSION_TONE[version.status]}>{version.status}</Badge>
                  </p>
                  <p className="mt-1 text-ink-muted">{summarize(version.policy ?? {})}</p>
                </div>
                {version.status === "draft" ? (
                  <ActionForm action={publishVersion} submitLabel="Publish" submitVariant="secondary">
                    <input type="hidden" name="policy_id" value={policy.id} />
                    <input type="hidden" name="version_id" value={version.id} />
                  </ActionForm>
                ) : null}
              </Panel>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="New draft">
        <Panel className="p-5 sm:p-6">
          <ActionForm action={addDraftVersion} submitLabel="Save draft">
            <input type="hidden" name="policy_id" value={policy.id} />
            <input type="hidden" name="expected_policy_version" value={policy.version} />
            <PolicyBodyFields idPrefix="draft" seed={draftSeed} publishLabel="Publish after saving" />
          </ActionForm>
        </Panel>
      </Section>
    </>
  );
}
