import { listAllStudents } from "@/lib/server/students";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, LoadError, PageHeader } from "@/components/staff/page-header";
import { CollegeFilter } from "@/components/staff/college-filter";
import { Tile } from "@/components/staff/tile";
import { departmentLabel, listBatches, listDepartments, listPlacement } from "@/lib/server/directory";
import { inColleges } from "@/lib/server/colleges";
import { collegesFor, requireStaff } from "@/lib/server/staff";
import { cn } from "@/lib/utils";
import { ImportDialog, ReissueDialog } from "./panels";
import { Roster } from "./roster";

export const metadata: Metadata = { title: "Students" };

export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ batch?: string; college?: string }> }) {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) redirect("/staff");
  const { batch: batchParam, college: collegeParam } = await searchParams;

  let data;
  try {
    const colleges = collegesFor(staff, collegeParam);
    const [perCollege, placement] = await Promise.all([
      inColleges(colleges, async (collegeId) => ({ batches: await listBatches(collegeId), departments: await listDepartments(collegeId) })),
      listPlacement(),
    ]);
    const batches = perCollege.flatMap(({ college, value }) => (value?.batches ?? []).map((candidate) => ({ ...candidate, collegeName: college.name })));
    const departments = perCollege.flatMap(({ value }) => value?.departments ?? []);
    const batch = batches.find((candidate) => candidate.id === batchParam) ?? batches[0];
    const students = batch ? await listAllStudents(batch.tenant_id, batch.id) : [];
    data = { batches, departments, placement, batch, students, unreachable: perCollege.filter((entry) => entry.failed).map((entry) => entry.college.name) };
  } catch (error) {
    return (
      <>
      <PageHeader title="Students" />
        <LoadError error={error} />
      </>
    );
  }
  const { batches, departments, placement, batch, students, unreachable } = data;
  const several = staff.isPlatformAdmin;
  const placements = placement.organizations.flatMap((organization) =>
    organization.departments.map((department) => ({ id: department.id, label: `${departmentLabel(department)}, ${organization.legal_name}` })),
  );
  const placementNames = Object.fromEntries(placements.map((option) => [option.id, option.label]));
  const departmentCode = new Map(departments.map((department) => [department.id, department.code]));

  const active = students.filter((student) => student.status === "active").length;
  const byPlacement = new Map<string, number>();
  for (const student of students) {
    const name = placementNames[student.placement_department_id ?? ""] ?? "Not visible to your role";
    byPlacement.set(name, (byPlacement.get(name) ?? 0) + 1);
  }
  const mix = [...byPlacement].sort((a, b) => b[1] - a[1]).slice(0, 4);

  return (
    <>
      <PageHeader
        title="Students"
        description="Import a batch from a spreadsheet, hand out passwords, and reset or disable accounts."
        actions={
          <>
            {staff.isPlatformAdmin && <CollegeFilter colleges={staff.tenants.map((tenant) => ({ id: tenant.id, name: tenant.display_name }))} />}
            <ImportDialog
              batches={batches}
              placements={placements}
              departments={departments}
              disabledReason={placements.length === 0 ? (placement.readable ? "Create a placement department first" : "Ask a platform administrator to create a placement department") : undefined}
            />
          </>
        }
      />
      {unreachable.length > 0 && <p role="alert" className="mb-4 text-sm text-warning">Could not load: {unreachable.join(", ")}.</p>}

      {batches.length === 0 ? (
        <EmptyState>
          Create a batch first, in <Link href="/staff/organisation" className="text-brand hover:underline">Departments</Link>.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <nav aria-label="Batches" className="flex gap-1.5 overflow-x-auto lg:flex-col lg:overflow-visible">
            <p className="hidden px-3 pb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle lg:block">Batches</p>
            {batches.map((candidate) => {
              const current = candidate.id === batch?.id;
              return (
                <Link
                  key={candidate.id}
                  href={`/staff/students?batch=${candidate.id}${collegeParam ? `&college=${collegeParam}` : ""}`}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "shrink-0 rounded-[var(--radius-control)] px-3 py-2 transition-colors",
                    current ? "bg-ink text-canvas" : "text-ink-muted hover:bg-hover hover:text-ink",
                  )}
                >
                  <span className="block text-[13.5px] font-medium">{candidate.name}</span>
                  <span className={cn("block font-mono text-[11px]", current ? "opacity-70" : "text-ink-subtle")}>
                    {departmentCode.get(candidate.department_id) ?? "?"} · {candidate.academic_year}
                    {several && candidate.collegeName ? ` · ${candidate.collegeName}` : ""}
                  </span>
                </Link>
              );
            })}
          </nav>

          {batch && (
            <div className="min-w-0 space-y-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-[-0.015em] text-ink">{batch.name}</h2>
                  <p className="text-[13px] text-ink-muted">Academic year {batch.academic_year}</p>
                </div>
                {students.length > 0 && <ReissueDialog batch={batch} />}
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr]">
                <Tile label="Students">
                  <p className="font-mono text-[28px] font-semibold leading-none tabular-nums text-ink">{students.length}</p>
                </Tile>
                <Tile label="Can sign in">
                  <p className="font-mono text-[28px] font-semibold leading-none tabular-nums text-ink">{active}</p>
                  {students.length > active && <p className="mt-2 text-[12px] text-ink-muted">{students.length - active} disabled</p>}
                </Tile>
                <Tile label="By placement department">
                  {mix.length === 0 ? (
                    <p className="text-[13px] text-ink-muted">Nothing to show until students are imported.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {mix.map(([name, count]) => (
                        <li key={name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-[13px]">
                          <span className="min-w-0 truncate text-ink-muted">{name}</span>
                          <span className="font-mono tabular-nums text-ink">{count}</span>
                          <span aria-hidden className="col-span-2 h-1 overflow-hidden rounded-full bg-hover">
                            <span className="block h-full rounded-full bg-ink/50" style={{ width: `${(count / students.length) * 100}%` }} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Tile>
              </div>

              <Roster key={batch.id} students={students} placementNames={placementNames} collegeId={batch.tenant_id} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
