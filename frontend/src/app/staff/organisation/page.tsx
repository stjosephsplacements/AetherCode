import { Briefcase, Building2, GraduationCap, Layers } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { CollegeFilter } from "@/components/staff/college-filter";
import { ConfirmDelete } from "@/components/staff/confirm-delete";
import { EditDialog } from "@/components/staff/edit-dialog";
import { Field, Select, TextInput } from "@/components/staff/form";
import { EmptyState, LoadError, PageHeader, Table } from "@/components/staff/page-header";
import { Pager } from "@/components/staff/pager";
import { Badge } from "@/components/ui/card";
import { paginate } from "@/lib/paginate";
import { inColleges } from "@/lib/server/colleges";
import { departmentLabel, listBatches, listDepartments, listPlacement } from "@/lib/server/directory";
import { collegesFor, requireStaff } from "@/lib/server/staff";
import { cn } from "@/lib/utils";
import { lettermark } from "../placements/stats";
import { AddDialog } from "./add-dialog";
import { createBatch, createDepartment, createPlacementDepartment, createPlacementOrganization, deleteBatch, deleteDepartment, deletePlacementOrganization, updateBatch, updateDepartment, updatePlacementOrganization } from "./actions";

export const metadata: Metadata = { title: "Departments" };

const TABS = [
  { key: "academic", label: "Academic departments" },
  { key: "placement", label: "Placement organisations" },
  { key: "batches", label: "Batches" },
] as const;
type Tab = (typeof TABS)[number]["key"];

/** A cell that keeps long names on one line, with the whole name on hover. */
const Clip = ({ children, className }: { children: string; className?: string }) => (
  <span className={cn("block max-w-[16rem] truncate", className)} title={children}>
    {children}
  </span>
);

const Avatar = ({ name }: { name: string }) => (
  <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-soft font-mono text-[12px] font-semibold text-brand-soft-ink">
    {lettermark(name)}
  </span>
);

const Named = ({ name, note }: { name: string; note?: string }) => (
  <div className="flex min-w-0 items-center gap-3">
    <Avatar name={name} />
    <div className="min-w-0">
      <Clip className="font-medium text-ink">{name}</Clip>
      {note && <Clip className="text-[11.5px] text-ink-subtle">{note}</Clip>}
    </div>
  </div>
);

/** The first few labels as badges, and how many more there are. */
function Few({ labels, empty }: { labels: string[]; empty: string }) {
  if (labels.length === 0) return <span className="text-xs text-ink-subtle">{empty}</span>;
  return (
    <div className="flex min-w-0 items-center gap-1" title={labels.join(", ")}>
      {labels.slice(0, 3).map((label) => (
        <Badge key={label} tone="neutral" className="max-w-[7rem]"><span className="truncate">{label}</span></Badge>
      ))}
      {labels.length > 3 && <span className="shrink-0 text-xs text-ink-subtle">+{labels.length - 3}</span>}
    </div>
  );
}

export default async function OrganisationPage({ searchParams }: { searchParams: Promise<{ college?: string; tab?: string; dp?: string; bp?: string; op?: string; pp?: string }> }) {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) redirect("/staff");
  let data;
  try {
    const query = await searchParams;
    const colleges = collegesFor(staff, query.college);
    const [perCollege, placement] = await Promise.all([
      inColleges(colleges, async (collegeId) => ({ departments: await listDepartments(collegeId), batches: await listBatches(collegeId) })),
      listPlacement(),
    ]);
    data = {
      departments: perCollege.flatMap(({ college, value }) => (value?.departments ?? []).filter((department) => department.department_type === "college").map((department) => ({ ...department, collegeId: college.id, collegeName: college.name }))),
      batches: perCollege.flatMap(({ college, value }) => (value?.batches ?? []).map((batch) => ({ ...batch, collegeId: college.id, collegeName: college.name }))),
      unreachable: perCollege.filter((entry) => entry.failed).map((entry) => entry.college.name),
      placement,
      query,
    };
  } catch (error) {
    return (
      <>
        <PageHeader title="Departments" />
        <LoadError error={error} />
      </>
    );
  }
  const { departments, batches, placement, unreachable, query } = data;
  const several = staff.isPlatformAdmin;
  const tab: Tab = TABS.find((entry) => entry.key === query.tab)?.key ?? "academic";
  const pagedDepartments = paginate(departments, query.dp);
  const pagedBatches = paginate(batches, query.bp);
  const pagedOrganizations = paginate(placement.organizations, query.op);
  const placementDepartments = placement.organizations.flatMap((organization) => organization.departments.map((department) => ({ department, organization })));
  const pagedPlacementDepartments = paginate(placementDepartments, query.pp);
  const departmentName = new Map(departments.map((department) => [department.id, departmentLabel(department)]));
  const batchesIn = (departmentId: string) => batches.filter((batch) => batch.department_id === departmentId);

  // A tab link keeps the college but starts that tab at its first page.
  const tabHref = (key: Tab) => {
    const next = new URLSearchParams();
    if (query.college) next.set("college", query.college);
    if (key !== "academic") next.set("tab", key);
    const text = next.toString();
    return text ? `/staff/organisation?${text}` : "/staff/organisation";
  };
  const chip = (icon: ReactNode, label: string, value: number) => (
    <li className="inline-flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-2.5 pr-3 text-[13px] text-ink-muted">
      <span aria-hidden className="text-brand">{icon}</span>
      {label}
      <span className="font-mono tabular-nums text-ink">{value}</span>
    </li>
  );

  const collegePicker = several && (
    <Field label="College" htmlFor="department-college">
      <Select id="department-college" name="college_id" required defaultValue={staff.tenants[0]?.id}>
        {staff.tenants.map((tenant) => (
          <option key={tenant.id} value={tenant.id}>
            {tenant.display_name}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <>
      <PageHeader
        title="Departments"
        description="Every student belongs to one college department, through a batch, and one placement department."
        actions={staff.isPlatformAdmin ? <CollegeFilter colleges={staff.tenants.map((tenant) => ({ id: tenant.id, name: tenant.display_name }))} /> : undefined}
      />
      {unreachable.length > 0 && <p role="alert" className="mb-4 text-sm text-warning">Could not load: {unreachable.join(", ")}.</p>}

      <ul className="mb-5 flex flex-wrap gap-2" aria-label="Summary">
        {chip(<Building2 className="size-3.5" />, "Departments", departments.length)}
        {chip(<GraduationCap className="size-3.5" />, "Batches", batches.length)}
        {chip(<Briefcase className="size-3.5" />, "Organisations", placement.organizations.length)}
        {chip(<Layers className="size-3.5" />, "Placement departments", placementDepartments.length)}
      </ul>

      <nav aria-label="Sections" className="mb-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-[var(--radius-control)] border border-line bg-sidebar p-1">
        {TABS.map((entry) => (
          <Link
            key={entry.key}
            href={tabHref(entry.key)}
            scroll={false}
            aria-current={entry.key === tab ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-[calc(var(--radius-control)-2px)] px-3.5 py-1.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-4 focus-visible:ring-brand/15",
              entry.key === tab ? "bg-surface text-ink shadow-[var(--shadow-hairline)]" : "text-ink-muted hover:text-ink",
            )}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      {tab === "academic" && (
        <section aria-label="Academic departments" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] text-ink-muted">College departments and the batches inside each.</p>
            <AddDialog label="Add department" title="New department" description="Students and batches are filed under it." submitLabel="Create department" action={createDepartment}>
              {collegePicker}
              <div className="grid grid-cols-3 gap-3">
                <Field label="Code" htmlFor="department-code">
                  <TextInput id="department-code" name="code" required maxLength={32} placeholder="CSE" />
                </Field>
                <Field label="Name" htmlFor="department-name" className="col-span-2">
                  <TextInput id="department-name" name="name" required placeholder="Computer Science" />
                </Field>
              </div>
            </AddDialog>
          </div>
          {departments.length === 0 ? (
            <EmptyState>No departments yet. Add the first one.</EmptyState>
          ) : (
            <>
              <Table head={several ? ["Department", "College", "Code", "Batches", ""] : ["Department", "Code", "Batches", ""]}>
                {pagedDepartments.rows.map((department) => {
                  const inside = batchesIn(department.id);
                  return (
                    <tr key={department.id}>
                      <td className="px-4 py-3"><Named name={department.name} /></td>
                      {several && <td className="px-4 py-3"><Badge tone="neutral" className="max-w-[12rem]"><span className="truncate">{department.collegeName}</span></Badge></td>}
                      <td className="px-4 py-3 font-mono text-xs text-ink-muted">{department.code}</td>
                      <td className="px-4 py-3"><Few labels={inside.map((batch) => batch.code)} empty="No batches" /></td>
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
                              return updateDepartment(department.collegeId, department.id, changes);
                            }}
                          />
                          {inside.length > 0 ? (
                            <span className="whitespace-nowrap text-xs text-ink-subtle">Delete its batches first</span>
                          ) : (
                            <ConfirmDelete
                              title={`Delete ${department.name}?`}
                              description="It has no batches. Students and staff already filed under it are not changed."
                              onConfirm={async (reason) => {
                                "use server";
                                return deleteDepartment(department.collegeId, department.id, reason);
                              }}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </Table>
              <Pager meta={pagedDepartments} param="dp" noun="departments" />
            </>
          )}
        </section>
      )}

      {tab === "batches" && (
        <section aria-label="Batches" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] text-ink-muted">A batch is one intake of a department, for example CSE A, 2026-2030.</p>
            <AddDialog
              label="Add batch"
              title="New batch"
              description="Students are enrolled into a batch."
              submitLabel="Create batch"
              action={createBatch}
              disabledReason={departments.length === 0 ? "Create a department first" : undefined}
            >
              <Field label="Department" htmlFor="batch-department">
                <Select id="batch-department" name="department_id" required>
                  {departments.map((department) => (
                    <option key={department.id} value={`${department.collegeId}:${department.id}`}>
                      {several ? `${department.collegeName}, ` : ""}
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
            </AddDialog>
          </div>
          {batches.length === 0 ? (
            <EmptyState>No batches yet. Create a department, then a batch in it.</EmptyState>
          ) : (
            <>
              <Table head={several ? ["Batch", "College", "Code", "Department", "Academic year", ""] : ["Batch", "Code", "Department", "Academic year", ""]}>
                {pagedBatches.rows.map((batch) => (
                  <tr key={batch.id}>
                    <td className="px-4 py-3"><Named name={batch.name} /></td>
                    {several && <td className="px-4 py-3"><Badge tone="neutral" className="max-w-[12rem]"><span className="truncate">{batch.collegeName}</span></Badge></td>}
                    <td className="px-4 py-3 font-mono text-xs text-ink-muted">{batch.code}</td>
                    <td className="px-4 py-3 text-ink-muted"><Clip>{departmentName.get(batch.department_id) ?? "Unknown"}</Clip></td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-ink-muted">{batch.academic_year}</td>
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
                            return updateBatch(batch.collegeId, batch.id, changes);
                          }}
                        />
                        <ConfirmDelete
                          title={`Delete ${batch.name}?`}
                          description="A batch that still has students cannot be deleted: move them first."
                          onConfirm={async (reason) => {
                            "use server";
                            return deleteBatch(batch.collegeId, batch.id, reason);
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
              <Pager meta={pagedBatches} param="bp" noun="batches" />
            </>
          )}
        </section>
      )}

      {tab === "placement" && (
        <section aria-label="Placement organisations" className="space-y-6">
          {!placement.readable ? (
            <EmptyState>Only a platform administrator can manage placement organisations.</EmptyState>
          ) : (
            <>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13px] text-ink-muted">Placement organisations, with the placement departments they run. These can span colleges.</p>
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
                {placement.organizations.length === 0 ? (
                  <EmptyState>No placement organisations yet.</EmptyState>
                ) : (
                  <>
                    <Table head={["Organisation", "Code", "Placement departments", ""]}>
                      {pagedOrganizations.rows.map((organization) => (
                        <tr key={organization.id}>
                          <td className="px-4 py-3"><Named name={organization.legal_name} /></td>
                          <td className="px-4 py-3 font-mono text-xs text-ink-muted">{organization.code}</td>
                          <td className="px-4 py-3"><Few labels={organization.departments.map((department) => department.code)} empty="None yet" /></td>
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
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Placement departments</h2>
                  <AddDialog
                    label="Add placement department"
                    title="New placement department"
                    submitLabel="Create placement department"
                    action={createPlacementDepartment}
                    variant="secondary"
                    disabledReason={placement.organizations.length === 0 ? "Create an organisation first" : undefined}
                  >
                    <Field label="Organisation" htmlFor="placement-organization">
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
                          <td className="px-4 py-3 text-ink-muted"><Clip>{organization.legal_name}</Clip></td>
                        </tr>
                      ))}
                    </Table>
                    <Pager meta={pagedPlacementDepartments} param="pp" noun="departments" />
                  </>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
