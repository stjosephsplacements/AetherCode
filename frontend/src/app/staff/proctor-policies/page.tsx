import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Field, TextInput } from "@/components/staff/form";
import { EmptyState, LoadError, PageHeader, Section } from "@/components/staff/page-header";
import { Badge, Panel } from "@/components/ui/card";
import type { ProctorPolicy } from "@/lib/api-types";
import { listAllProctorPolicies, listProctorPolicyVersions } from "@/lib/server/proctor-policies";
import { requireCollege } from "@/lib/server/staff";
import { createPolicy } from "./actions";
import { PolicyBodyFields } from "./policy-fields";

export const metadata: Metadata = { title: "Proctor policies" };

export default async function ProctorPoliciesPage() {
  const { tenantId } = await requireCollege();
  let policies: ProctorPolicy[];
  let publishedByPolicy: Record<string, number>;
  try {
    policies = await listAllProctorPolicies(tenantId);
    publishedByPolicy = Object.fromEntries(
      await Promise.all(
        policies.map(async (policy) => {
          const versions = await listProctorPolicyVersions(tenantId, policy.id, "published");
          return [policy.id, versions.length] as const;
        }),
      ),
    );
  } catch (error) {
    return (
      <>
        <PageHeader title="Proctor policies" />
        <LoadError error={error} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Proctor policies"
        description="Webcam rules for exams: which violations count, cooldown, and when to auto-submit."
      />
      <Section title="New policy">
        <Panel className="p-5 sm:p-6">
          <ActionForm action={createPolicy} submitLabel="Create policy">
            <Field label="Name" htmlFor="policy-name">
              <TextInput id="policy-name" name="name" required maxLength={160} placeholder="Lab camera rules" />
            </Field>
            <PolicyBodyFields idPrefix="policy" publishDefaultChecked publishLabel="Publish immediately" />
          </ActionForm>
        </Panel>
      </Section>
      <Section title="Policies">
        {policies.length === 0 ? (
          <EmptyState>No policies yet. Create one above, then attach it when you schedule an exam.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {policies.map((policy) => (
              <li key={policy.id}>
                <Link
                  href={`/staff/proctor-policies/${policy.id}`}
                  className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line bg-surface px-4 py-3 text-sm transition-colors hover:bg-hover"
                >
                  <span className="font-medium text-ink">{policy.name}</span>
                  <span className="flex items-center gap-2 text-ink-muted">
                    <Badge tone={publishedByPolicy[policy.id] ? "success" : "warning"}>
                      {publishedByPolicy[policy.id] ? `${publishedByPolicy[policy.id]} published` : "No published version"}
                    </Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
