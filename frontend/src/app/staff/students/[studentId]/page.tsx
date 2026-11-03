import { ArrowLeft, ArrowSquareOut } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ConfirmDelete } from "@/components/staff/confirm-delete";
import { EditDialog } from "@/components/staff/edit-dialog";
import { EmptyState, LoadError, PageHeader, Section } from "@/components/staff/page-header";
import { Badge, Panel } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { AccountSummary, ProfileLink, Student } from "@/lib/api-types";
import { listDepartments, departmentLabel } from "@/lib/server/directory";
import { communityList } from "@/lib/server/community";
import { describeAccounts } from "@/lib/server/people";
import { platformStats } from "@/lib/server/platforms";
import { gateway } from "@/lib/server/gateway";
import { collegeFor, requireStaff } from "@/lib/server/staff";
import { deleteStudent, updateStudent } from "../actions";
import { StudentActions } from "../panels";

export const metadata: Metadata = { title: "Student profile" };

export default async function StudentDetailPage({ params }: { params: Promise<{ studentId: string }> }) {
  const staff = await requireStaff();
  const collegeId = collegeFor(staff);
  if (!staff.canManageAccounts) redirect("/staff");
  const { studentId } = await params;

  let data;
  try {
    const [departments, student] = await Promise.all([
      listDepartments(collegeId),
      gateway<Student>(`/user/v1/tenants/${collegeId}/students/${studentId}`).catch(() => null),
    ]);

    const [accountMap, links] = student
      ? await Promise.all([
          describeAccounts(collegeId, [student.principal_id]).catch(() => new Map<string, AccountSummary>()),
          communityList<ProfileLink>(collegeId, "profile-links").catch(() => [] as ProfileLink[]),
        ])
      : [new Map<string, AccountSummary>(), [] as ProfileLink[]];
    const stats = await platformStats(links.filter((link) => link.handle));

    data = { student, account: student ? accountMap.get(student.principal_id) : undefined, departments, stats };
  } catch (error) {
    return (
      <>
        <PageHeader title="Student Profile" />
        <LoadError error={error} />
      </>
    );
  }

  // notFound() throws a route-control error, so it must run outside the try.
  if (!data.student) notFound();
  const { student, account, departments, stats } = data;
  const deptMap = new Map(departments.map((d) => [d.id, departmentLabel(d)]));
  const dept = deptMap.get(student.college_department_id || "") || "General Engineering";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" asChild>
          <Link href="/staff/students" className="gap-1.5">
            <ArrowLeft className="size-4" />
            Back to students
          </Link>
        </Button>
      </div>

      <PageHeader
        title={account?.display_name || student.enrollment_number}
        description={`Roll number: ${student.enrollment_number} · Status: ${student.status}`}
        actions={
          <>
            <EditDialog
              title="Edit student"
              description="Name and email belong to the account. The roll number must be unique in this college."
              fields={[{ name: "enrollment_number", label: "Roll number", value: student.enrollment_number }]}
              onSave={async (changes) => {
                "use server";
                return updateStudent(collegeId, student.id, changes);
              }}
            />
            <ConfirmDelete
              title={`Delete ${student.enrollment_number}?`}
              description="The student record is removed. To stop someone signing in without losing anything, turn their account off instead."
              confirmText={student.enrollment_number}
              redirectTo="/staff/students"
              onConfirm={async (reason) => {
                "use server";
                return deleteStudent(collegeId, student.id, reason);
              }}
            />
          </>
        }
      />

      {/* Main Student Card */}
      <div className="grid gap-6 sm:grid-cols-3">
        <Panel className="p-6 sm:col-span-2 space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-ink">{account?.display_name || "Enrolled Student"}</h2>
              <p className="text-sm font-medium text-brand">{dept}</p>
            </div>
            <Badge tone={student.status === "active" ? "success" : "danger"}>{student.status}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-line pt-4 text-xs">
            <div>
              <span className="text-ink-muted uppercase font-bold tracking-wider block mb-0.5">Username</span>
              <span className="font-mono font-medium text-ink">{account?.username || student.enrollment_number}</span>
            </div>
            <div>
              <span className="text-ink-muted uppercase font-bold tracking-wider block mb-0.5">Email</span>
              <span className="font-medium text-ink">{account?.email || "Not specified"}</span>
            </div>
            <div>
              <span className="text-ink-muted uppercase font-bold tracking-wider block mb-0.5">Enrollment / Roll No</span>
              <span className="font-mono font-medium text-ink">{student.enrollment_number}</span>
            </div>
            <div>
              <span className="text-ink-muted uppercase font-bold tracking-wider block mb-0.5">Principal ID</span>
              <span className="font-mono text-[11px] text-ink-muted">{student.principal_id.slice(0, 18)}...</span>
            </div>
          </div>
        </Panel>

        {/* Account actions */}
        <Panel className="p-6 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink-muted">Account Administration</h3>
          <p className="text-xs text-ink-muted">Reset passwords or enable/disable account sign-in access.</p>
          <StudentActions principalId={student.principal_id} username={account?.username || student.enrollment_number} collegeId={collegeId} status={account?.status ?? student.status} />
        </Panel>
      </div>


      {/* Competitive Profiles */}
      <Section title="Linked Coding Profiles" description="External platforms linked by the student.">
        {stats.length === 0 ? (
          <EmptyState>No external coding profiles linked yet.</EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {stats.map((stat) => (
              <Panel key={stat.platform} className="p-4 bg-canvas/30">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm capitalize text-ink">{stat.platform}</span>
                  <a href={stat.url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand hover:underline inline-flex items-center gap-1">
                    {stat.handle}
                    <ArrowSquareOut className="size-3" />
                  </a>
                </div>
                {stat.lines && stat.lines.length > 0 ? (
                  <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
                    {stat.lines.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-ink-muted">Profile connected</p>
                )}
              </Panel>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
