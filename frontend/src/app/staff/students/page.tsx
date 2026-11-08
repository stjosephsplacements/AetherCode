import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, LoadError, PageHeader } from "@/components/staff/page-header";
import { SkulletSuspense } from "@/components/skullet-suspense";
import { departmentLabel, listBatches, listDepartments, listPlacement } from "@/lib/server/directory";
import { inColleges } from "@/lib/server/colleges";
import { describeAccounts } from "@/lib/server/people";
import { collegesFor, requireStaff } from "@/lib/server/staff";
import { listRoster } from "@/lib/server/students";
import { EnrolDialog, ImportDialog } from "./panels";
import { Roster, type StudentRow } from "./roster";

export const metadata: Metadata = { title: "Students" };

export default async function StudentsPage() {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) redirect("/staff");
  return (
    <>
      <PageHeader
        title="Students"
        description="Add students one by one or import a spreadsheet. Manage passwords and accounts."
      />
      <SkulletSuspense id="students" label="Loading students">
        <StudentsContent staff={staff} />
      </SkulletSuspense>
    </>
  );
}

async function StudentsContent({ staff }: { staff: Awaited<ReturnType<typeof requireStaff>> }) {
  let data;
  try {
    const colleges = collegesFor(staff);
    const [perCollege, placement] = await Promise.all([
      inColleges(colleges, async (collegeId) => {
        const [batches, departments] = await Promise.all([listBatches(collegeId), listDepartments(collegeId)]);
        const students = await listRoster(collegeId, batches.map((batch) => batch.id));
        const people = await describeAccounts(collegeId, students.flatMap((student) => [student.principal_id, ...student.mentor_principal_ids])).catch(() => new Map());
        return { batches, departments, students, people };
      }),
      listPlacement(),
    ]);
    data = { perCollege, placement };
  } catch (error) {
    return <LoadError error={error} />;
  }
  const { perCollege, placement } = data;
  const placements = placement.organizations.flatMap((organization) =>
    organization.departments.map((department) => ({ id: department.id, label: `${departmentLabel(department)}, ${organization.legal_name}` })),
  );
  const placementName = new Map(placements.map((option) => [option.id, option.label]));
  const batches = perCollege.flatMap(({ college, value }) => (value?.batches ?? []).map((batch) => ({ ...batch, collegeName: college.name })));
  const departments = perCollege.flatMap(({ value }) => value?.departments ?? []);
  const unreachable = perCollege.filter((entry) => entry.failed).map((entry) => entry.college.name);

  const rows: StudentRow[] = perCollege.flatMap(({ college, value }) => {
    if (!value) return [];
    const departmentOf = new Map(value.departments.map((department) => [department.id, departmentLabel(department)]));
    const batchOf = new Map(value.batches.map((batch) => [batch.id, batch]));
    return value.students.map((student) => {
      const person = value.people.get(student.principal_id);
      const batch = batchOf.get(student.batch_id ?? "");
      const mentors = student.mentor_principal_ids.map((id) => value.people.get(id)?.display_name).filter((name): name is string => Boolean(name));
      return {
        id: student.id,
        principalId: student.principal_id,
        tenantId: student.tenant_id,
        college: college.name,
        roll: student.enrollment_number,
        name: person?.display_name ?? student.profile_name ?? "",
        email: person?.email ?? "",
        phone: person?.phone ?? "",
        joinedAt: person?.created_at ?? "",
        lastSignIn: person?.last_authenticated_at ?? "",
        passwordState: person?.password_state ?? "",
        username: person?.username ?? student.enrollment_number.toLowerCase(),
        status: student.status,
        batchId: student.batch_id ?? "",
        batch: batch ? `${batch.name} (${batch.academic_year})` : "No batch",
        department: departmentOf.get(student.college_department_id ?? batch?.department_id ?? "") ?? "",
        mentors: mentors.join(", "),
        placementId: student.placement_department_id ?? "",
        placement: placementName.get(student.placement_department_id ?? "") ?? "Not visible to your role",
      };
    });
  });

  const why = placements.length === 0 ? (placement.readable ? "Create a placement department first" : "Ask a platform administrator to create a placement department") : undefined;

  const dialogs = batches.length > 0 && (
    <>
      <ImportDialog batches={batches} placements={placements} departments={departments} disabledReason={why} />
      <EnrolDialog batches={batches} placements={placements} departments={departments} disabledReason={why} />
    </>
  );

  return (
    <>
      {unreachable.length > 0 && <p role="alert" className="mb-4 text-sm text-warning">Could not load: {unreachable.join(", ")}.</p>}
      {batches.length === 0 ? (
        <EmptyState>
          <p className="mb-3 text-[15px] font-medium text-ink">No batches yet</p>
          Students belong to a batch. Create one in{" "}
          <Link href="/staff/departments" className="text-brand hover:underline">
            Departments
          </Link>{" "}
          first, then come back to import them.
        </EmptyState>
      ) : (
        <Roster rows={rows} several={false} actions={dialogs} />
      )}
    </>
  );
}
