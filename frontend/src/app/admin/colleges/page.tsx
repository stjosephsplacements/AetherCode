import { ArrowRight } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CollegeLink } from "@/components/college-link";
import { ConfirmDelete } from "@/components/staff/confirm-delete";
import { EditDialog } from "@/components/staff/edit-dialog";
import { Field, TextInput } from "@/components/staff/form";
import { EmptyState, LoadError, PageHeader } from "@/components/staff/page-header";
import { Pager } from "@/components/staff/pager";
import { Badge } from "@/components/ui/card";
import type { Page, Tenant } from "@/lib/api-types";
import { lettermark } from "@/lib/lettermark";
import { collegeHref } from "@/lib/links";
import { paginate } from "@/lib/paginate";
import { inColleges } from "@/lib/server/colleges";
import { listBatches, listDepartments } from "@/lib/server/directory";
import { gateway } from "@/lib/server/gateway";
import { requireStaff } from "@/lib/server/staff";
import { AddDialog } from "../../staff/departments/add-dialog";
import { createCollege, deleteCollege, updateCollege } from "./actions";

export const metadata: Metadata = { title: "Colleges" };

export default async function CollegesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const staff = await requireStaff();
  if (!staff.isPlatformAdmin) redirect("/staff");
  let tenants: Tenant[];
  try {
    tenants = (await gateway<Page<Tenant>>("/tenant/v1/tenants?limit=100")).items;
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="Colleges" />
        <LoadError error={error} />
      </div>
    );
  }
  const counts = new Map(
    (
      await inColleges(
        tenants.map((tenant) => ({ id: tenant.id, name: tenant.display_name })),
        async (id) => ({
          departments: (await listDepartments(id)).filter((department) => department.department_type === "college").length,
          batches: (await listBatches(id)).length,
        }),
      )
    ).map(({ college, value }) => [college.id, value]),
  );
  const paged = paginate(tenants, (await searchParams).page);
  const active = tenants.filter((tenant) => tenant.status === "active").length;
  const totals = { departments: 0, batches: 0 };
  for (const value of counts.values()) {
    totals.departments += value?.departments ?? 0;
    totals.batches += value?.batches ?? 0;
  }

  const addCollege = (
    <AddDialog
      label="Add college"
      title="New college"
      description="Departments, batches, staff and students are filed under it."
      submitLabel="Add college"
      action={createCollege}
    >
      <Field label="Display name" htmlFor="college-display">
        <TextInput id="college-display" name="display_name" maxLength={255} required placeholder="St. Joseph's College of Engineering" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Short name" hint="Lowercase letters, digits and dashes" htmlFor="college-slug" className="sm:col-span-1">
          <TextInput id="college-slug" name="slug" pattern="[a-z0-9][a-z0-9-]{1,62}" maxLength={63} required placeholder="sjce" />
        </Field>
        <Field label="Legal name" htmlFor="college-legal" className="sm:col-span-2">
          <TextInput id="college-legal" name="legal_name" maxLength={255} required />
        </Field>
      </div>
    </AddDialog>
  );

  return (
    <div className="animate-enter space-y-6">
      <PageHeader
        title="Colleges"
        description={`${active} active of ${tenants.length} · ${totals.departments} departments · ${totals.batches} batches. Open a workspace to manage each college.`}
        actions={addCollege}
      />

      <section aria-label="College directory">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Directory</h2>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              {paged.total} college{paged.total === 1 ? "" : "s"}
              {paged.pages > 1 ? ` · page ${paged.page} of ${paged.pages}` : ""}
            </p>
          </div>
        </div>

        {tenants.length === 0 ? (
          <div className="rounded-surface border border-dashed border-line-strong bg-surface px-6 py-14 text-center shadow-[var(--shadow-panel)]">
            <EmptyState>
              <p className="mb-2 text-[15px] font-medium text-ink">No colleges yet</p>
              Add the first college to start setting up departments, students and exams.
            </EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-surface border border-line bg-surface shadow-[var(--shadow-panel)]">
            {paged.rows.map((tenant) => {
              const count = counts.get(tenant.id);
              return (
                <li key={tenant.id} className="group flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-hover sm:flex-nowrap">
                  <CollegeLink
                    href={collegeHref("/staff", tenant.id)}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <span
                      aria-hidden
                      className="grid size-10 shrink-0 place-items-center rounded-control bg-brand-soft font-mono text-[13px] font-semibold text-brand-soft-ink"
                    >
                      {lettermark(tenant.display_name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[14.5px] font-semibold text-ink">{tenant.display_name}</span>
                        <Badge tone={tenant.status === "active" ? "success" : "neutral"}>
                          {tenant.status === "active" ? "Active" : tenant.status}
                        </Badge>
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[11.5px] text-ink-subtle">{tenant.slug}</span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-ink-muted">{tenant.legal_name}</span>
                    </span>
                  </CollegeLink>

                  <dl className="flex shrink-0 items-center gap-4 font-mono text-[12px] tabular-nums text-ink-muted">
                    <div className="text-right">
                      <dt className="text-[10px] uppercase tracking-[0.08em] text-ink-subtle">Depts</dt>
                      <dd className="mt-0.5 text-[13.5px] text-ink">{count ? count.departments : "—"}</dd>
                    </div>
                    <div className="text-right">
                      <dt className="text-[10px] uppercase tracking-[0.08em] text-ink-subtle">Batches</dt>
                      <dd className="mt-0.5 text-[13.5px] text-ink">{count ? count.batches : "—"}</dd>
                    </div>
                  </dl>

                  <div className="flex w-full shrink-0 items-center gap-1 sm:w-auto sm:justify-end">
                    <CollegeLink
                      href={collegeHref("/staff", tenant.id)}
                      className="inline-flex items-center gap-1 rounded-pill px-3 py-1.5 text-[13px] font-medium text-brand transition-colors hover:bg-hover"
                    >
                      Workspace
                      <ArrowRight className="size-3.5 opacity-70" />
                    </CollegeLink>
                    <CollegeLink
                      href={collegeHref("/staff/departments", tenant.id)}
                      className="rounded-pill px-3 py-1.5 text-[13px] text-ink-muted transition-colors hover:bg-hover hover:text-ink"
                    >
                      Departments
                    </CollegeLink>
                    <div className="ml-auto flex items-center gap-0.5 sm:ml-0">
                      <EditDialog
                        title={`Edit ${tenant.display_name}`}
                        description="Only changed fields are saved."
                        fields={[
                          { name: "display_name", label: "Display name", value: tenant.display_name },
                          { name: "legal_name", label: "Legal name", value: tenant.legal_name },
                        ]}
                        onSave={async (changes) => {
                          "use server";
                          return updateCollege(tenant.id, changes);
                        }}
                      />
                      <ConfirmDelete
                        title={`Delete ${tenant.display_name}?`}
                        description="The college and everything filed under it stop appearing. Its students can no longer sign in. This is for a college that should not exist; turn accounts off to pause one."
                        confirmText={tenant.slug}
                        onConfirm={async (reason) => {
                          "use server";
                          return deleteCollege(tenant.id, reason);
                        }}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Pager meta={paged} noun="colleges" />
      </section>
    </div>
  );
}
