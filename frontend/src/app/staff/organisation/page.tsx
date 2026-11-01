import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, Field, Select, TextInput } from "@/components/staff/form";
import { EmptyState, LoadError, PageHeader, Section, Table } from "@/components/staff/page-header";
import { CollegeBar } from "@/components/staff/college-bar";
import { ConfirmDelete } from "@/components/staff/confirm-delete";
import { EditDialog } from "@/components/staff/edit-dialog";
import { Panel } from "@/components/ui/card";
import { departmentLabel, listBatches, listDepartments, listPlacement } from "@/lib/server/directory";
import { requireCollege } from "@/lib/server/staff";
import { createBatch, createDepartment, createPlacementDepartment, createPlacementOrganization, deleteBatch, deleteDepartment, deletePlacementOrganization, updateBatch, updateDepartment, updatePlacementOrganization } from "./actions";

export const metadata: Metadata = { title: "Departments" };

export default async function OrganisationPage() {
  const staff = await requireCollege();
  if (!staff.canManageAccounts) redirect("/staff");
  let data;
  try {
    const [departments, batches, placement] = await Promise.all([
      listDepartments(staff.tenantId),
      listBatches(staff.tenantId),
      listPlacement(),
    ]);
    data = { departments: departments.filter((department) => department.department_type === "college"), batches, placement };
  } catch (error) {
    return (
      <>
        <CollegeBar staff={staff} />
      <PageHeader title="Departments" />
        <LoadError error={error} />
      </>
    );
  }
  const { departments, batches, placement } = data;
  const departmentName = new Map(departments.map((department) => [department.id, departmentLabel(department)]));

  return (
    <>
      <CollegeBar staff={staff} />
      <PageHeader
        title="Departments"
        description="Every student belongs to one college department, through a batch, and one placement department."
      />

      <Section title="College departments and batches">
        {departments.length > 0 && (
          <div className="mb-4">
            <Table head={["Department", "Code", "Batches", ""]}>
              {departments.map((department) => {
                const inside = batches.filter((batch) => batch.department_id === department.id).length;
                return (
                  <tr key={department.id}>
                    <td className="px-4 py-3 font-medium text-ink">{department.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-muted">{department.code}</td>
                    <td className="px-4 py-3 tabular-nums text-ink-muted">{inside}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <EditDialog
                          title={`Edit ${department.name}`}
                          fields={[
                            { name: "name", label: "Name", value: department.name },
                            { name: "code", label: "Code", value: department.code, hint: "Unique within the college." },
                          ]}
                          onSave={async (changes) => {
                            "use server";
                            return updateDepartment(department.id, changes);
                          }}
                        />
                        {inside > 0 ? (
                          <span className="text-xs text-ink-subtle">Delete its batches first</span>
                        ) : (
                          <ConfirmDelete
                            title={`Delete ${department.name}?`}
                            description="It has no batches. Students and staff already filed under it are not changed."
                            onConfirm={async (reason) => {
                              "use server";
                              return deleteDepartment(department.id, reason);
                            }}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Table>
          </div>
        )}
        {batches.length === 0 ? (
          <EmptyState>No batches yet. Create a department, then a batch in it.</EmptyState>
        ) : (
          <Table head={["Batch", "Code", "Department", "Academic year", ""]}>
            {batches.map((batch) => (
              <tr key={batch.id}>
                <td className="px-4 py-3 font-medium text-ink">{batch.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-ink-muted">{batch.code}</td>
                <td className="px-4 py-3 text-ink-muted">{departmentName.get(batch.department_id) ?? "Unknown"}</td>
                <td className="px-4 py-3 text-ink-muted">{batch.academic_year}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <EditDialog
                      title={`Edit ${batch.name}`}
                      fields={[
                        { name: "name", label: "Name", value: batch.name },
                        { name: "code", label: "Code", value: batch.code },
                        { name: "academic_year", label: "Academic year", value: batch.academic_year, hint: "Like 2026-2030." },
                      ]}
                      onSave={async (changes) => {
                        "use server";
                        return updateBatch(batch.id, changes);
                      }}
                    />
                    <ConfirmDelete
                      title={`Delete ${batch.name}?`}
                      description="A batch that still has students cannot be deleted: move them first."
                      onConfirm={async (reason) => {
                        "use server";
                        return deleteBatch(batch.id, reason);
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Panel className="p-5">
            <h3 className="mb-4 text-sm font-semibold text-ink">New department</h3>
            <ActionForm action={createDepartment} submitLabel="Create department">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Code" htmlFor="department-code">
                  <TextInput id="department-code" name="code" required maxLength={32} placeholder="CSE" />
                </Field>
                <Field label="Name" htmlFor="department-name" className="col-span-2">
                  <TextInput id="department-name" name="name" required placeholder="Computer Science" />
                </Field>
              </div>
            </ActionForm>
          </Panel>
          <Panel className="p-5">
            <h3 className="mb-4 text-sm font-semibold text-ink">New batch</h3>
            {departments.length === 0 ? (
              <p className="text-sm text-ink-muted">Create a department first.</p>
            ) : (
              <ActionForm action={createBatch} submitLabel="Create batch">
                <Field label="Department" htmlFor="batch-department">
                  <Select id="batch-department" name="department_id" required>
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {departmentLabel(department)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Code" htmlFor="batch-code">
                    <TextInput id="batch-code" name="code" required placeholder="CSE-A" />
                  </Field>
                  <Field label="Name" htmlFor="batch-name">
                    <TextInput id="batch-name" name="name" required placeholder="CSE A" />
                  </Field>
                  <Field label="Year" htmlFor="batch-year">
                    <TextInput id="batch-year" name="academic_year" required placeholder="2026-2027" pattern="\d{4}-\d{4}" />
                  </Field>
                </div>
              </ActionForm>
            )}
          </Panel>
        </div>
      </Section>

      <Section title="Placement departments" description="Placement departments belong to a placement organization and can span colleges.">
        {!placement.readable ? (
          <EmptyState>Only a platform administrator can manage placement organizations.</EmptyState>
        ) : placement.organizations.length === 0 ? (
          <EmptyState>No placement organizations yet.</EmptyState>
        ) : (
          <>
          <div className="mb-4">
            <Table head={["Placement organization", "Code", ""]}>
              {placement.organizations.map((organization) => (
                <tr key={organization.id}>
                  <td className="px-4 py-3 font-medium text-ink">{organization.legal_name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-muted">{organization.code}</td>
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
          </div>
          <Table head={["Placement department", "Code", "Organization"]}>
            {placement.organizations.flatMap((organization) =>
              organization.departments.map((department) => (
                <tr key={department.id}>
                  <td className="px-4 py-3 font-medium text-ink">{department.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-muted">{department.code}</td>
                  <td className="px-4 py-3 text-ink-muted">{organization.legal_name}</td>
                </tr>
              )),
            )}
          </Table>
          </>
        )}
        {placement.readable && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Panel className="p-5">
              <h3 className="mb-4 text-sm font-semibold text-ink">New placement organization</h3>
              <ActionForm action={createPlacementOrganization} submitLabel="Create organization">
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Code" htmlFor="organization-code">
                    <TextInput id="organization-code" name="code" required placeholder="TPC" />
                  </Field>
                  <Field label="Legal name" htmlFor="organization-name" className="col-span-2">
                    <TextInput id="organization-name" name="legal_name" required placeholder="Training and Placement Cell" />
                  </Field>
                </div>
              </ActionForm>
            </Panel>
            {placement.organizations.length > 0 && (
              <Panel className="p-5">
                <h3 className="mb-4 text-sm font-semibold text-ink">New placement department</h3>
                <ActionForm action={createPlacementDepartment} submitLabel="Create placement department">
                  <Field label="Organization" htmlFor="placement-organization">
                    <Select id="placement-organization" name="organization_id" required>
                      {placement.organizations.map((organization) => (
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
                </ActionForm>
              </Panel>
            )}
          </div>
        )}
      </Section>
    </>
  );
}
