import { ArrowRight, Buildings } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FigureCard } from "@/app/admin/_dashboard/charts";
import { panel } from "@/app/admin/_dashboard/panel";
import { ConfirmDelete } from "@/components/staff/confirm-delete";
import { EditDialog } from "@/components/staff/edit-dialog";
import { Field, Select, TextInput } from "@/components/staff/form";
import { EmptyState, LoadError, PageHeader } from "@/components/staff/page-header";
import { Pager } from "@/components/staff/pager";
import { Badge } from "@/components/ui/card";
import { lettermark } from "@/lib/lettermark";
import { paginate } from "@/lib/paginate";
import { inColleges } from "@/lib/server/colleges";
import { listBatches, listDepartments } from "@/lib/server/directory";
import { collegesFor, requireStaff } from "@/lib/server/staff";
import { cn } from "@/lib/utils";
import { AddDialog } from "./add-dialog";
import { createDepartment, deleteDepartment, updateDepartment } from "./actions";

export const metadata: Metadata = { title: "Departments" };

/** A cell that keeps long names on one line, with the whole name on hover. */
const Clip = ({ children, className }: { children: string; className?: string }) => (
  <span className={cn("block max-w-[16rem] truncate", className)} title={children}>
    {children}
  </span>
);

/** The first few labels as badges, and how many more there are. */
function Few({ labels, empty }: { labels: string[]; empty: string }) {
  if (labels.length === 0) return <span className="text-[12px] text-ink-subtle">{empty}</span>;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1" title={labels.join(", ")}>
      {labels.slice(0, 3).map((label) => (
        <Badge key={label} tone="neutral" className="max-w-[7rem]">
          <span className="truncate">{label}</span>
        </Badge>
      ))}
      {labels.length > 3 && <span className="shrink-0 text-[12px] text-ink-subtle">+{labels.length - 3}</span>}
    </div>
  );
}

export default async function OrganisationPage({ searchParams }: { searchParams: Promise<{ college?: string; dp?: string }> }) {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) redirect("/staff");
  let data;
  try {
    const query = await searchParams;
    const colleges = collegesFor(staff);
    const perCollege = await inColleges(colleges, async (collegeId) => ({ departments: await listDepartments(collegeId), batches: await listBatches(collegeId) }));
    data = {
      departments: perCollege.flatMap(({ college, value }) =>
        (value?.departments ?? [])
          .filter((department) => department.department_type === "college")
          .map((department) => ({ ...department, collegeId: college.id, collegeName: college.name })),
      ),
      batches: perCollege.flatMap(({ college, value }) => (value?.batches ?? []).map((batch) => ({ ...batch, collegeId: college.id, collegeName: college.name }))),
      unreachable: perCollege.filter((entry) => entry.failed).map((entry) => entry.college.name),
      query,
    };
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="Departments" />
        <LoadError error={error} />
      </div>
    );
  }
  const { departments, batches, unreachable, query } = data;
  const several = false;
  const pagedDepartments = paginate(departments, query.dp);
  const batchesIn = (departmentId: string) => batches.filter((batch) => batch.department_id === departmentId);
  const emptyDepartments = departments.filter((department) => batchesIn(department.id).length === 0).length;
  const years = new Set(batches.map((batch) => batch.academic_year)).size;

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
    <div className="animate-enter">
      <PageHeader
        title="Departments"
        description="Academic departments for this college. Manage batches under Departments → Batches."
      />
      {unreachable.length > 0 && (
        <p role="alert" className="mb-4 text-sm text-warning">
          Could not load: {unreachable.join(", ")}.
        </p>
      )}

      <div className="grid auto-rows-[minmax(120px,auto)] gap-3 md:grid-cols-6 xl:grid-cols-12">
        <FigureCard label="Departments" value={String(departments.length)} note="academic units" className="md:col-span-2 xl:col-span-3" />
        <FigureCard label="Batches" value={String(batches.length)} note="across all departments" className="md:col-span-2 xl:col-span-3" />
        <FigureCard
          label="Empty"
          value={String(emptyDepartments)}
          note="departments with no batch"
          tone={emptyDepartments ? "warn" : "good"}
          className="md:col-span-2 xl:col-span-3"
        />
        <FigureCard label="Years" value={String(years)} note="distinct academic years" className="md:col-span-6 xl:col-span-3" />

        <section aria-label="Academic departments" className={cn(panel, "md:col-span-6 xl:col-span-12")}>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-control bg-brand/15 text-brand">
                <Buildings className="size-4" />
              </span>
              <div>
                <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Academic departments</h2>
                <p className="mt-0.5 text-[12.5px] text-ink-muted">
                  Add departments here. Batches live under{" "}
                  <Link href="/staff/departments/batches" className="text-brand hover:underline">
                    Batches
                  </Link>
                  .
                </p>
              </div>
            </div>
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
            <EmptyState>
              <p className="mb-2 text-[15px] font-medium text-ink">No departments yet</p>
              Add the first academic department, then open it to create batches.
            </EmptyState>
          ) : (
            <>
              <ul className="space-y-2">
                {pagedDepartments.rows.map((department) => {
                  const inside = batchesIn(department.id);
                  const batchesHref = `/staff/departments/batches?department=${department.id}`;
                  return (
                    <li key={department.id} className="flex flex-wrap items-center gap-3 rounded-control border border-line bg-hover/30 px-3.5 py-3 transition-colors hover:bg-hover sm:flex-nowrap">
                      <Link href={batchesHref} className="flex min-w-0 flex-1 items-center gap-3 outline-none focus-visible:ring-4 focus-visible:ring-brand/15">
                        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-control bg-brand-soft font-mono text-[12px] font-semibold text-brand-soft-ink">
                          {lettermark(department.name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <Clip className="text-[14px] font-semibold text-ink">{department.name}</Clip>
                            <span className="font-mono text-[11.5px] text-ink-subtle">{department.code}</span>
                          </span>
                          <span className="mt-1.5 block">
                            <Few labels={inside.map((batch) => batch.code)} empty="No batches yet" />
                          </span>
                        </span>
                        <span className="hidden shrink-0 font-mono text-[11.5px] tabular-nums text-ink-subtle sm:inline">
                          {inside.length} batch{inside.length === 1 ? "" : "es"}
                        </span>
                        <ArrowRight className="size-4 shrink-0 text-ink-subtle" />
                      </Link>
                      <div className="flex shrink-0 items-center gap-1">
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
                          <span className="whitespace-nowrap text-[12px] text-ink-subtle">Delete batches first</span>
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
                    </li>
                  );
                })}
              </ul>
              <Pager meta={pagedDepartments} param="dp" noun="departments" />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
