import type { Metadata } from "next";
import Link from "next/link";
import { FigureCard } from "@/app/admin/_dashboard/charts";
import { panel } from "@/app/admin/_dashboard/panel";
import { ActionForm, Field, TextInput } from "@/components/staff/form";
import { EmptyState, LoadError, PageHeader } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import type { ProctorPolicy } from "@/lib/api-types";
import { listAllProctorPolicies, listProctorPolicyVersions } from "@/lib/server/proctor-policies";
import { requireCollege } from "@/lib/server/staff";
import { cn } from "@/lib/utils";
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
      <div className="animate-enter">
        <PageHeader title="Proctor policies" />
        <LoadError error={error} />
      </div>
    );
  }

  const published = policies.filter((policy) => publishedByPolicy[policy.id]).length;

  return (
    <div className="animate-enter">
      <PageHeader
        title="Proctor policies"
        description="Webcam rules for exams: which violations count, cooldown, and when to auto-submit."
      />

      <div className="grid gap-3 xl:grid-cols-12">
        <FigureCard label="Policies" value={String(policies.length)} note="this college" className="xl:col-span-4" />
        <FigureCard label="Published" value={String(published)} note="ready to attach" tone="good" className="xl:col-span-4" />
        <FigureCard label="Draft only" value={String(policies.length - published)} note="need a published version" tone={policies.length - published ? "warn" : "good"} className="xl:col-span-4" />

        <section className={cn(panel, "xl:col-span-5")}>
          <div className="mb-4">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">New policy</h2>
            <p className="mt-1 text-[12.5px] text-ink-muted">Name the rules, then attach a published version when you schedule an exam.</p>
          </div>
          <ActionForm action={createPolicy} submitLabel="Create policy">
            <Field label="Name" htmlFor="policy-name">
              <TextInput id="policy-name" name="name" required maxLength={160} placeholder="Lab camera rules" />
            </Field>
            <PolicyBodyFields idPrefix="policy" publishDefaultChecked publishLabel="Publish immediately" />
          </ActionForm>
        </section>

        <section className={cn(panel, "xl:col-span-7")}>
          <div className="mb-3">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Policies</h2>
            <p className="mt-1 text-[12.5px] text-ink-muted">Open one to edit versions and publish.</p>
          </div>
          {policies.length === 0 ? (
            <EmptyState>No policies yet. Create one on the left, then attach it when you schedule an exam.</EmptyState>
          ) : (
            <ul className="space-y-1.5" aria-label="Proctor policies">
              {policies.map((policy) => {
                const count = publishedByPolicy[policy.id] ?? 0;
                return (
                  <li key={policy.id}>
                    <Link
                      href={`/staff/proctor-policies/${policy.id}`}
                      className="flex items-center justify-between gap-3 rounded-control border border-line bg-hover/30 px-3.5 py-3 text-sm transition-colors hover:bg-hover"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{policy.name}</span>
                        <span className="mt-0.5 block font-mono text-[11px] text-ink-subtle">{policy.id.slice(0, 8)}</span>
                      </span>
                      <Badge tone={count ? "success" : "warning"}>{count ? `${count} published` : "No published version"}</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
