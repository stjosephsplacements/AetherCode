import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, LoadError, PageHeader, Section } from "@/components/staff/page-header";
import { Badge, Panel } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Student, ProfileLink } from "@/lib/api-types";
import { listDepartments, departmentLabel } from "@/lib/server/directory";
import { describeAccounts } from "@/lib/server/people";
import { platformStats } from "@/lib/server/platforms";
import { communityList } from "@/lib/server/community";
import { gateway } from "@/lib/server/gateway";
import { requireCollege } from "@/lib/server/staff";
import { StudentActions } from "../panels";

export const metadata: Metadata = { title: "Student profile" };

export default async function StudentDetailPage({ params }: { params: Promise<{ studentId: string }> }) {
  const staff = await requireCollege();
  const { studentId } = await params;

  let data;
  try {
    const [departments, student] = await Promise.all([
      listDepartments(staff.tenantId),
      gateway<Student>(`/user/v1/tenants/${staff.tenantId}/students/${studentId}`).catch(() => null),
    ]);

    if (!student) notFound();

    const [accountMap, links] = await Promise.all([
      describeAccounts(staff.tenantId, [student.principal_id]).catch(() => new Map()),
      communityList<ProfileLink>(staff.tenantId, "profile-links").catch(() => []),
    ]);

    const account = accountMap.get(student.principal_id);
    const stats = await platformStats(links.filter((l) => l.handle));

    data = { student, account, departments, stats };
  } catch (error) {
    return (
      <>
        <PageHeader title="Student Profile" />
        <LoadError error={error} />
      </>
    );
  }

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
          <StudentActions principalId={student.principal_id} username={account?.username || student.enrollment_number} />
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
                    <ExternalLink className="size-3" />
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
