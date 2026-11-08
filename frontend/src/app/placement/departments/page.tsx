import { Briefcase, Stack } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { ConfirmDelete } from "@/components/staff/confirm-delete";
import { EditDialog } from "@/components/staff/edit-dialog";
import { Field, Select, TextInput } from "@/components/staff/form";
import { EmptyState, LoadError, PageHeader, Table } from "@/components/staff/page-header";
import { Pager } from "@/components/staff/pager";
import { paginate } from "@/lib/paginate";
import { listPlacement } from "@/lib/server/directory";
import { requirePlacement } from "@/lib/server/placement";
import { lettermark } from "@/lib/lettermark";
import { cn } from "@/lib/utils";
import { AddDialog } from "../../staff/departments/add-dialog";
import { createPlacementDepartment, createPlacementOrganization, deletePlacementOrganization, updatePlacementOrganization } from "./actions";

export const metadata: Metadata = { title: "Placement departments" };

const Named = ({ name }: { name: string }) => (
  <span className="flex items-center gap-2.5">
    <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-soft font-mono text-[12px] font-semibold text-brand-soft-ink">
      {lettermark(name)}
    </span>
    <span className="truncate">{name}</span>
  </span>
);

const Few = ({ labels, empty }: { labels: string[]; empty: string }) =>
  labels.length === 0 ? (
    <span className="text-ink-subtle">{empty}</span>
  ) : (
    <span className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <span key={label} className="inline-block rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-ink-muted">
          {label}
        </span>
      ))}
    </span>
  );

export default async function PlacementDepartmentsPage({ searchParams }: { searchParams: Promise<{ op?: string; pp?: string }> }) {
  await requirePlacement();
  let data;
  try {
    data = await listPlacement();
  } catch (error) {
    return (
      <>
        <PageHeader title="Placement departments" />
        <LoadError error={error} />
      </>
    );
  }
  const query = await searchParams;
  const pagedOrganizations = paginate(data.organizations, query.op);
  const placementDepartments = data.organizations.flatMap((organization) => organization.departments.map((department) => ({ department, organization })));
  const pagedPlacementDepartments = paginate(placementDepartments, query.pp);

  return (
    <>
      <PageHeader
        title="Placement departments"
        description="Placement organisations (like Training and Placement Cell) and their departments (like ELITE, HOPE, PEP). These span colleges — students from any department or batch can be assigned to a placement track."
      />

      <ul className="mb-5 flex flex-wrap gap-2" aria-label="Summary">
        <li className={cn("inline-flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-2.5 pr-3 text-[13px] text-ink-muted")}>
          <span aria-hidden className="text-brand"><Briefcase className="size-3.5" /></span>
          Organisations
          <span className="font-mono tabular-nums text-ink">{data.organizations.length}</span>
        </li>
        <li className={cn("inline-flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-2.5 pr-3 text-[13px] text-ink-muted")}>
          <span aria-hidden className="text-brand"><Stack className="size-3.5" /></span>
          Departments
          <span className="font-mono tabular-nums text-ink">{placementDepartments.length}</span>
        </li>
      </ul>

      {!data.readable ? (
        <EmptyState>Only a platform administrator can manage placement organisations.</EmptyState>
      ) : (
        <div className="space-y-8">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Organisations</h2>
              <AddDialog label="Add organisation" title="New placement organisation" submitLabel="Create organisation" action={createPlacementOrganization}>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Code" htmlFor="organization-code">
                    <TextInput id="organization-code" name="code" required placeholder="TPC" />
                  </Field>
                  <Field label="Legal name" htmlFor="organization-name" className="col-span-2">
                    <TextInput id="organization-name" name="legal_name" required placeholder="Training and Placement Cell" />
                  </Field>
                </div>
              </AddDialog>
            </div>
            {data.organizations.length === 0 ? (
              <EmptyState>No placement organisations yet.</EmptyState>
            ) : (
              <>
                <Table head={["Organisation", "Code", "Placement departments", ""]}>
                  {pagedOrganizations.rows.map((organization) => (
                    <tr key={organization.id}>
                      <td className="px-4 py-3"><Named name={organization.legal_name} /></td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-muted">{organization.code}</td>
                      <td className="px-4 py-3"><Few labels={organization.departments.map((d) => d.code)} empty="None yet" /></td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <EditDialog
                            title={`Edit ${organization.legal_name}`}
                            fields={[{ name: "legal_name", label: "Legal name", value: organization.legal_name }]}
                            onSave={async (changes) => {
                              "use server";
                              return updatePlacementOrganization(organization.id, changes);
                            }}
                          />
                          <ConfirmDelete
                            title={`Delete ${organization.legal_name}?`}
                            description="Its placement departments go with it. Students already placed through it keep their records."
                            confirmText={organization.code}
                            onConfirm={async (reason) => {
                              "use server";
                              return deletePlacementOrganization(organization.id, reason);
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </Table>
                <Pager meta={pagedOrganizations} param="op" noun="organisations" />
              </>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Placement departments</h2>
              <AddDialog
                label="Add placement department"
                title="New placement department"
                submitLabel="Create placement department"
                action={createPlacementDepartment}
                variant="secondary"
                disabledReason={data.organizations.length === 0 ? "Create an organisation first" : undefined}
              >
                <Field label="Organisation" htmlFor="placement-organization">
                  <Select id="placement-organization" name="organization_id" required>
                    {data.organizations.map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {organization.legal_name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Code" htmlFor="placement-code">
                    <TextInput id="placement-code" name="code" required placeholder="TPO" />
                  </Field>
                  <Field label="Name" htmlFor="placement-name" className="col-span-2">
                    <TextInput id="placement-name" name="name" required placeholder="Training and Placement" />
                  </Field>
                </div>
              </AddDialog>
            </div>
            {placementDepartments.length === 0 ? (
              <EmptyState>No placement departments yet.</EmptyState>
            ) : (
              <>
                <Table head={["Placement department", "Code", "Organisation"]}>
                  {pagedPlacementDepartments.rows.map(({ department, organization }) => (
                    <tr key={department.id}>
                      <td className="px-4 py-3"><Named name={department.name} /></td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-muted">{department.code}</td>
                      <td className="px-4 py-3 text-ink-muted"><span className="block max-w-[16rem] truncate" title={organization.legal_name}>{organization.legal_name}</span></td>
                    </tr>
                  ))}
                </Table>
                <Pager meta={pagedPlacementDepartments} param="pp" noun="departments" />
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
