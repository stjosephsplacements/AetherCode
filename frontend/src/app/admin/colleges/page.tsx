import { Buildings, CheckCircle, GraduationCap, Stack } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ConfirmDelete } from "@/components/staff/confirm-delete";
import { EditDialog } from "@/components/staff/edit-dialog";
import { Field, TextInput } from "@/components/staff/form";
import { EmptyState, LoadError, PageHeader, Table } from "@/components/staff/page-header";
import { Pager } from "@/components/staff/pager";
import { Badge } from "@/components/ui/card";
import type { Page, Tenant } from "@/lib/api-types";
import { paginate } from "@/lib/paginate";
import { inColleges } from "@/lib/server/colleges";
import { listBatches, listDepartments } from "@/lib/server/directory";
import { gateway } from "@/lib/server/gateway";
import { requireStaff } from "@/lib/server/staff";
import { AddDialog } from "../../staff/departments/add-dialog";
import { lettermark } from "../../staff/placements/stats";
import { createCollege, deleteCollege, updateCollege } from "./actions";

export const metadata: Metadata = { title: "Colleges" };

const chip = (icon: ReactNode, label: string, value: number) => (
  <li className="inline-flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-2.5 pr-3 text-[13px] text-ink-muted">
    <span aria-hidden className="text-brand">{icon}</span>
    {label}
    <span className="font-mono tabular-nums text-ink">{value}</span>
  </li>
);

export default async function CollegesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const staff = await requireStaff();
  if (!staff.isPlatformAdmin) redirect("/staff");
  let tenants: Tenant[];
  try {
    tenants = (await gateway<Page<Tenant>>("/tenant/v1/tenants?limit=100")).items;
  } catch (error) {
    return (
      <>
        <PageHeader title="Colleges" />
        <LoadError error={error} />
      </>
    );
  }
  const counts = new Map(
    (await inColleges(tenants.map((tenant) => ({ id: tenant.id, name: tenant.display_name })), async (id) => ({ departments: (await listDepartments(id)).filter((d) => d.department_type === "college").length, batches: (await listBatches(id)).length }))).map(({ college, value }) => [college.id, value]),
  );
  const paged = paginate(tenants, (await searchParams).page);
  const totals = { departments: 0, batches: 0 };
  for (const value of counts.values()) {
    totals.departments += value?.departments ?? 0;
    totals.batches += value?.batches ?? 0;
  }

  const addCollege = (
    <AddDialog label="Add college" title="New college" description="Departments, batches, staff and students are filed under it." submitLabel="Add college" action={createCollege}>
      <Field label="Display name" htmlFor="college-display">
        <TextInput id="college-display" name="display_name" maxLength={255} required placeholder="St. Joseph's College of Engineering" />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Short name" hint="Lowercase letters, digits and dashes" htmlFor="college-slug" className="col-span-1">
          <TextInput id="college-slug" name="slug" pattern="[a-z0-9][a-z0-9-]{1,62}" maxLength={63} required placeholder="sjce" />
        </Field>
        <Field label="Legal name" htmlFor="college-legal" className="col-span-2">
          <TextInput id="college-legal" name="legal_name" maxLength={255} required />
        </Field>
      </div>
    </AddDialog>
  );

  return (
    <>
      <PageHeader title="Colleges" description="Every college on this platform. Each has its own departments, students, staff, exams and results." actions={addCollege} />
      <ul className="mb-5 flex flex-wrap gap-2" aria-label="Summary">
        {chip(<Buildings className="size-3.5" />, "Colleges", tenants.length)}
        {chip(<CheckCircle className="size-3.5" />, "Active", tenants.filter((tenant) => tenant.status === "active").length)}
        {chip(<Stack className="size-3.5" />, "Departments", totals.departments)}
        {chip(<GraduationCap className="size-3.5" />, "Batches", totals.batches)}
      </ul>
      {tenants.length === 0 ? (
        <EmptyState>
          <p className="mb-3 text-[15px] font-medium text-ink">No colleges yet</p>
          Add the first college to start setting up departments, students and exams.
        </EmptyState>
      ) : (
        <Table head={["College", "Short name", "Departments", "Batches", "Status", ""]}>
          {paged.rows.map((tenant) => {
            const count = counts.get(tenant.id);
            return (
              <tr key={tenant.id}>
                <td className="px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-soft font-mono text-[12px] font-semibold text-brand-soft-ink">
                      {lettermark(tenant.display_name)}
                    </span>
                    <div className="min-w-0">
                      <p className="max-w-[18rem] truncate font-medium text-ink" title={tenant.display_name}>{tenant.display_name}</p>
                      <p className="max-w-[18rem] truncate text-[11.5px] text-ink-subtle" title={tenant.legal_name}>{tenant.legal_name}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-ink-muted">{tenant.slug}</td>
                <td className="px-4 py-3 tabular-nums text-ink-muted">{count ? count.departments : "-"}</td>
                <td className="px-4 py-3 tabular-nums text-ink-muted">{count ? count.batches : "-"}</td>
                <td className="px-4 py-3">
                  <Badge tone={tenant.status === "active" ? "success" : "neutral"}>{tenant.status === "active" ? "Active" : tenant.status}</Badge>
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <Link href={`/staff/departments?college=${tenant.id}`} className="rounded-full px-3 py-1.5 text-[13px] text-brand transition-colors hover:bg-hover">
                      Departments
                    </Link>
                    <EditDialog
                      title={`Edit ${tenant.display_name}`}
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
                </td>
              </tr>
            );
          })}
        </Table>
      )}
      <Pager meta={paged} noun="colleges" />
    </>
  );
}
