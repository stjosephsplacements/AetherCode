import { Briefcase, Warning } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { panel } from "@/app/admin/_dashboard/panel";
import { ConfirmDelete } from "@/components/staff/confirm-delete";
import { EditDialog } from "@/components/staff/edit-dialog";
import { Field, TextInput } from "@/components/staff/form";
import { EmptyState, LoadError, PageHeader } from "@/components/staff/page-header";
import { Pager } from "@/components/staff/pager";
import { Badge } from "@/components/ui/card";
import { lettermark } from "@/lib/lettermark";
import { paginate } from "@/lib/paginate";
import { listPlacement } from "@/lib/server/directory";
import { primaryPlacementOrganization } from "@/lib/server/placement-org";
import { requireAdmin } from "@/lib/server/staff";
import { cn } from "@/lib/utils";
import { AddDialog } from "../../../staff/departments/add-dialog";
import {
  createPlacementDepartment,
  createPlacementOrganization,
  deletePlacementOrganization,
  updatePlacementOrganization,
} from "../actions";

export const metadata: Metadata = { title: "Placement organisation" };

/** Create the sole placement org and its global tracks (ADR-0080 / ADR-0089). */
export default async function AdminPlacementDepartmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdmin();
  let data;
  try {
    data = await listPlacement();
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="Organisation and departments" />
        <LoadError error={error} />
      </div>
    );
  }

  const organization = primaryPlacementOrganization(data);
  const extras = data.organizations.slice(1);
  const departments = organization?.departments ?? [];
  const paged = paginate(departments, (await searchParams).page);

  return (
    <div className="animate-enter space-y-6">
      <PageHeader
        title="Organisation and departments"
        description="One placement organisation for the whole platform. Departments under it (ELITE, HOPE, PEP, …) are global — every college assigns students to the same tracks."
        actions={
          organization ? (
            <AddDialog
              label="Add department"
              title="New placement department"
              description="Available to every college as soon as it is created."
              submitLabel="Create department"
              action={createPlacementDepartment}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Code" htmlFor="placement-code">
                  <TextInput id="placement-code" name="code" required placeholder="ELITE" />
                </Field>
                <Field label="Name" htmlFor="placement-name" className="sm:col-span-2">
                  <TextInput id="placement-name" name="name" required placeholder="ELITE track" />
                </Field>
              </div>
            </AddDialog>
          ) : undefined
        }
      />

      {!data.readable ? (
        <EmptyState>Could not load placement organisations.</EmptyState>
      ) : (
        <>
          {extras.length > 0 && (
            <section className={cn(panel)}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-control bg-warning/15 text-warning">
                  <Warning className="size-4" weight="fill" />
                </span>
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-ink">Extra organisations found</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
                    This console uses only {organization?.legal_name ?? "the first organisation"}. Delete the extras if they were created by mistake.
                  </p>
                  <ul className="mt-3 space-y-2">
                    {extras.map((extra) => (
                      <li key={extra.id} className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line bg-hover/40 px-3 py-2">
                        <span className="min-w-0">
                          <span className="block truncate text-[13.5px] font-medium text-ink">{extra.legal_name}</span>
                          <span className="font-mono text-[11px] text-ink-subtle">{extra.code}</span>
                        </span>
                        <ConfirmDelete
                          title={`Delete ${extra.legal_name}?`}
                          description="Its placement departments go with it. Students already placed through it keep their records."
                          confirmText={extra.code}
                          onConfirm={async (reason) => {
                            "use server";
                            return deletePlacementOrganization(extra.id, reason);
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          )}

          <section aria-label="Organisation" className={cn(panel)}>
            {!organization ? (
              <div className="space-y-4">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">No organisation yet</h2>
                  <p className="mt-1 max-w-[54ch] text-[13.5px] text-ink-muted">
                    Create the single organisation for this deployment, then add departments.
                  </p>
                </div>
                <AddDialog
                  label="Create organisation"
                  title="Placement organisation"
                  description="There is only one. Every college will use its departments."
                  submitLabel="Create organisation"
                  action={createPlacementOrganization}
                >
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Code" htmlFor="organization-code">
                      <TextInput id="organization-code" name="code" required placeholder="SJPTC" />
                    </Field>
                    <Field label="Legal name" htmlFor="organization-name" className="sm:col-span-2">
                      <TextInput id="organization-name" name="legal_name" required placeholder="St. Joseph's Placements and Training Cell" />
                    </Field>
                  </div>
                </AddDialog>
              </div>
            ) : (
              <div className="flex flex-wrap items-start gap-4">
                <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-control bg-brand-soft font-mono text-[13px] font-semibold text-brand-soft-ink">
                  {lettermark(organization.legal_name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-ink-muted">Organisation</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[17px] font-semibold tracking-[-0.02em] text-ink">
                    <span className="truncate">{organization.legal_name}</span>
                    <Badge tone={organization.status === "active" ? "success" : "neutral"}>{organization.status}</Badge>
                  </p>
                  <p className="mt-0.5 font-mono text-[12px] text-ink-subtle">
                    {organization.code} · {departments.length} department{departments.length === 1 ? "" : "s"} · every college
                  </p>
                  <div className="mt-3">
                    <EditDialog
                      title={`Edit ${organization.legal_name}`}
                      fields={[{ name: "legal_name", label: "Legal name", value: organization.legal_name }]}
                      onSave={async (changes) => {
                        "use server";
                        return updatePlacementOrganization(organization.id, changes);
                      }}
                    />
                  </div>
                </div>
                <Briefcase className="size-4 shrink-0 text-brand" />
              </div>
            )}
          </section>

          <section aria-label="Departments">
            <div className="mb-3">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Departments</h2>
              <p className="mt-0.5 text-[13px] text-ink-muted">Global tracks. Students from any college enrol under these.</p>
            </div>
            {!organization ? (
              <EmptyState>Create the organisation first, then add tracks.</EmptyState>
            ) : departments.length === 0 ? (
              <EmptyState>
                <p className="mb-2 text-[15px] font-medium text-ink">No departments yet</p>
                Add tracks such as ELITE, HOPE or PEP. They apply across all colleges.
              </EmptyState>
            ) : (
              <>
                <ul className="divide-y divide-line overflow-hidden rounded-surface border border-line bg-surface shadow-[var(--shadow-panel)]">
                  {paged.rows.map((department) => (
                    <li key={department.id} className="flex items-center gap-3 px-4 py-3">
                      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-control bg-brand-soft font-mono text-[12px] font-semibold text-brand-soft-ink">
                        {lettermark(department.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold text-ink">{department.name}</span>
                        <span className="font-mono text-[11.5px] text-ink-subtle">{department.code}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <Pager meta={paged} noun="departments" />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
