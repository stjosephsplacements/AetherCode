import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, LoadError, PageHeader, Section, Table } from "@/components/staff/page-header";
import { Badge, Panel } from "@/components/ui/card";
import type { Page, Student } from "@/lib/api-types";
import { departmentLabel, listBatches, listDepartments, listPlacement } from "@/lib/server/directory";
import { gateway } from "@/lib/server/gateway";
import { requireCollege } from "@/lib/server/staff";
import { cn } from "@/lib/utils";
import { ImportPanel, ReissuePanel, StudentActions } from "./panels";

export const metadata: Metadata = { title: "Students" };

export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  const staff = await requireCollege();
  if (!staff.canManageAccounts) redirect("/staff");
  const { batch: batchParam } = await searchParams;

  let data;
  try {
    const [batches, departments, placement] = await Promise.all([listBatches(staff.tenantId), listDepartments(staff.tenantId), listPlacement()]);
    const batch = batches.find((candidate) => candidate.id === batchParam) ?? batches[0];
    const students = batch
      ? (await gateway<Page<Student>>(`/user/v1/tenants/${staff.tenantId}/students?batch_id=${batch.id}&limit=100`)).items
      : [];
    data = { batches, departments, placement, batch, students };
  } catch (error) {
    return (
      <>
        <PageHeader title="Students" />
        <LoadError error={error} />
      </>
    );
  }
  const { batches, departments, placement, batch, students } = data;
  const placements = placement.organizations.flatMap((organization) =>
    organization.departments.map((department) => ({ id: department.id, label: `${departmentLabel(department)}, ${organization.legal_name}` })),
  );
  const placementName = new Map(placements.map((option) => [option.id, option.label]));

  return (
    <>
      <PageHeader title="Students" description="Import a batch from a spreadsheet, hand out passwords, and reset or disable accounts." />

      {batches.length === 0 ? (
        <EmptyState>
          Create a batch first, in <Link href="/staff/organisation" className="text-brand hover:underline">Departments</Link>.
        </EmptyState>
      ) : (
        <>
          <nav aria-label="Batches" className="flex flex-wrap gap-1.5">
            {batches.map((candidate) => (
              <Link
                key={candidate.id}
                href={`/staff/students?batch=${candidate.id}`}
                className={cn(
                  "rounded-full px-3 py-1 text-[13px] transition-colors",
                  candidate.id === batch?.id ? "bg-ink text-canvas" : "bg-hover text-ink-muted hover:text-ink",
                )}
              >
                {candidate.name}
              </Link>
            ))}
          </nav>

          {batch && (
            <Section
              title={`${batch.name}, ${students.length} student${students.length === 1 ? "" : "s"}`}
              description={`Academic year ${batch.academic_year}`}
            >
              {students.length === 0 ? (
                <EmptyState>No students in this batch yet. Import them below.</EmptyState>
              ) : (
                <Table head={["Roll number", "Placement department", "Status", ""]}>
                  {students.map((student) => (
                    <tr key={student.id}>
                      <td className="px-4 py-2.5 font-mono text-[13px]">
                        <Link href={`/staff/students/${student.id}`} className="font-medium text-brand hover:underline">
                          {student.enrollment_number}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-ink-muted">{placementName.get(student.placement_department_id ?? "") ?? "Not visible to your role"}</td>
                      <td className="px-4 py-2.5">
                        <Badge tone={student.status === "active" ? "success" : "neutral"}>{student.status}</Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <StudentActions principalId={student.principal_id} username={student.enrollment_number.toLowerCase()} />
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
              {students.length > 0 && (
                <div className="mt-4">
                  <ReissuePanel batch={batch} />
                </div>
              )}
            </Section>
          )}

          <Section title="Import students" description="Each student gets a username (their roll number in lowercase) and a one-time password.">
            <Panel className="p-5">
              {placements.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  Every student needs a placement department.{" "}
                  {placement.readable ? "Create one in Departments first." : "Ask a platform administrator to create one."}
                </p>
              ) : (
                <ImportPanel batches={batches} placements={placements} departments={departments} />
              )}
            </Panel>
          </Section>
        </>
      )}
    </>
  );
}
