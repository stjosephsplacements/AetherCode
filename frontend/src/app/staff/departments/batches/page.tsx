import { ArrowRight, GraduationCap } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FigureCard } from "@/app/admin/_dashboard/charts";
import { panel } from "@/app/admin/_dashboard/panel";
import { ConfirmDelete } from "@/components/staff/confirm-delete";
import { EditDialog } from "@/components/staff/edit-dialog";
import { Field, TextInput } from "@/components/staff/form";
import { EmptyState, LoadError, PageHeader } from "@/components/staff/page-header";
import { Pager } from "@/components/staff/pager";
import { lettermark } from "@/lib/lettermark";
import { paginate } from "@/lib/paginate";
import { departmentLabel, listBatches, listDepartments } from "@/lib/server/directory";
import { collegeFor, requireStaff } from "@/lib/server/staff";
import { cn } from "@/lib/utils";
import { AddDialog } from "../add-dialog";
import { createBatch, deleteBatch, updateBatch } from "../actions";

export const metadata: Metadata = { title: "Batches" };

export default async function BatchesPage({ searchParams }: { searchParams: Promise<{ department?: string; bp?: string }> }) {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) redirect("/staff");
  const collegeId = collegeFor(staff);
  const { department: departmentParam, bp } = await searchParams;

  let data;
  try {
    const [departments, batches] = await Promise.all([listDepartments(collegeId), listBatches(collegeId)]);
    data = {
      departments: departments.filter((department) => department.department_type === "college"),
      batches,
    };
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="Batches" />
        <LoadError error={error} />
      </div>
    );
  }

  const { departments, batches } = data;
  const selected = departments.find((department) => department.id === departmentParam) ?? null;
  const scoped = selected ? batches.filter((batch) => batch.department_id === selected.id) : [];
  const paged = paginate(scoped, bp);
  const years = new Set(scoped.map((batch) => batch.academic_year)).size;

  return (
    <div className="animate-enter">
      <PageHeader
        title="Batches"
        description="Pick a department, then add and manage the batches students enrol into."
      />

      {departments.length === 0 ? (
        <section className={cn(panel)}>
          <EmptyState>
            <p className="mb-2 text-[15px] font-medium text-ink">No departments yet</p>
            Create a department first, then come back to add batches.{" "}
            <Link href="/staff/departments" className="text-brand hover:underline">
              Open departments
            </Link>
          </EmptyState>
        </section>
      ) : (
        <div className="grid gap-3 xl:grid-cols-12">
          <section className={cn(panel, "xl:col-span-4")}>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Department</h2>
            <p className="mt-1 text-[12.5px] text-ink-muted">Choose which department’s batches to manage.</p>
            <ul className="mt-4 space-y-2">
              {departments.map((department) => {
                const count = batches.filter((batch) => batch.department_id === department.id).length;
                const active = selected?.id === department.id;
                return (
                  <li key={department.id}>
                    <Link
                      href={`/staff/departments/batches?department=${department.id}`}
                      className={cn(
                        "flex items-center gap-3 rounded-control border px-3.5 py-3 transition-colors",
                        active ? "border-brand/40 bg-brand-soft/20" : "border-line bg-hover/30 hover:bg-hover",
                      )}
                    >
                      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-control bg-brand-soft font-mono text-[12px] font-semibold text-brand-soft-ink">
                        {lettermark(department.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold text-ink">{department.name}</span>
                        <span className="font-mono text-[11.5px] text-ink-subtle">
                          {department.code} · {count} batch{count === 1 ? "" : "es"}
                        </span>
                      </span>
                      <ArrowRight className={cn("size-4 shrink-0", active ? "text-brand" : "text-ink-subtle")} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          {!selected ? (
            <section className={cn(panel, "xl:col-span-8")}>
              <EmptyState>
                <p className="mb-2 text-[15px] font-medium text-ink">Select a department</p>
                Choose one on the left to see and edit its batches.
              </EmptyState>
            </section>
          ) : (
            <div className="flex min-w-0 flex-col gap-3 xl:col-span-8">
              <div className="grid gap-3 sm:grid-cols-3">
                <FigureCard label="Department" value={selected.code} note={selected.name} />
                <FigureCard label="Batches" value={String(scoped.length)} note="in this department" />
                <FigureCard label="Years" value={String(years)} note="distinct academic years" />
              </div>

              <section aria-label={`Batches for ${selected.name}`} className={cn(panel, "flex-1")}>
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="grid size-8 place-items-center rounded-control bg-brand/15 text-brand">
                      <GraduationCap className="size-4" />
                    </span>
                    <div>
                      <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Batches</h2>
                      <p className="mt-0.5 text-[12.5px] text-ink-muted">{departmentLabel(selected)}</p>
                    </div>
                  </div>
                  <AddDialog
                    label="Add batch"
                    title="New batch"
                    description={`Students enrol into a batch under ${selected.name}.`}
                    submitLabel="Create batch"
                    action={createBatch}
                  >
                    <input type="hidden" name="department_id" value={`${collegeId}:${selected.id}`} />
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Code" htmlFor="batch-code">
                        <TextInput id="batch-code" name="code" required placeholder={`${selected.code}-A`} />
                      </Field>
                      <Field label="Name" htmlFor="batch-name">
                        <TextInput id="batch-name" name="name" required placeholder={`${selected.code} A`} />
                      </Field>
                      <Field label="Year" htmlFor="batch-year">
                        <TextInput id="batch-year" name="academic_year" required placeholder="2026-2027" pattern="\d{4}-\d{4}" />
                      </Field>
                    </div>
                  </AddDialog>
                </div>

                {scoped.length === 0 ? (
                  <EmptyState>
                    <p className="mb-2 text-[15px] font-medium text-ink">No batches yet</p>
                    Create a batch so students have somewhere to enrol under {selected.name}.
                  </EmptyState>
                ) : (
                  <>
                    <ul className="space-y-2">
                      {paged.rows.map((batch) => (
                        <li key={batch.id} className="flex flex-wrap items-center gap-3 rounded-control border border-line bg-hover/30 px-3.5 py-3 sm:flex-nowrap">
                          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-control bg-brand-soft font-mono text-[12px] font-semibold text-brand-soft-ink">
                            {lettermark(batch.name)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-[14px] font-semibold text-ink" title={batch.name}>
                                {batch.name}
                              </span>
                              <span className="font-mono text-[11.5px] text-ink-subtle">{batch.code}</span>
                            </div>
                            <p className="mt-1 font-mono text-[11.5px] text-ink-subtle">{batch.academic_year}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <EditDialog
                              title={`Edit ${batch.name}`}
                              fields={[
                                { name: "name", label: "Name", value: batch.name },
                                { name: "code", label: "Code", value: batch.code },
                                { name: "academic_year", label: "Academic year", value: batch.academic_year, hint: "Like 2026-2030." },
                              ]}
                              onSave={async (changes) => {
                                "use server";
                                return updateBatch(collegeId, batch.id, changes);
                              }}
                            />
                            <ConfirmDelete
                              title={`Delete ${batch.name}?`}
                              description="A batch that still has students cannot be deleted: move them first."
                              onConfirm={async (reason) => {
                                "use server";
                                return deleteBatch(collegeId, batch.id, reason);
                              }}
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                    <Pager meta={paged} param="bp" noun="batches" />
                  </>
                )}
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
