import { Briefcase, Building2, CheckCircle2, ChevronRight, Download, Filter, GraduationCap, Users } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState, LoadError, PageHeader, Section, Table } from "@/components/staff/page-header";
import { Badge, Panel } from "@/components/ui/card";
import { listBatches, listDepartments, listPlacement, departmentLabel } from "@/lib/server/directory";
import { listAllStudents } from "@/lib/server/students";
import { requireCollege } from "@/lib/server/staff";
import { PlacementsFilter } from "./placements-filter";

export const metadata: Metadata = { title: "Placements" };

export default async function PlacementsPage() {
  const staff = await requireCollege();
  let data;
  try {
    const [placement, departments, batches, students] = await Promise.all([
      listPlacement(),
      listDepartments(staff.tenantId),
      listBatches(staff.tenantId),
      listAllStudents(staff.tenantId),
    ]);
    data = { placement, departments, batches, students };
  } catch (error) {
    return (
      <>
        <PageHeader title="Placements & Campus Drives" />
        <LoadError error={error} />
      </>
    );
  }

  const { placement, departments, batches, students } = data;
  const collegeDepts = departments.filter((d) => d.department_type === "college");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Placements & Campus Drives"
        description="Oversee corporate placement organizations, training cohorts (HOPE, PEP, Elite), and track student recruitment eligibility across engineering departments."
      />

      {/* Metrics overview */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[var(--radius-surface)] border border-line bg-surface p-5">
          <div className="flex items-center justify-between text-ink-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">Placement Cells</span>
            <Building2 className="size-4 text-brand" />
          </div>
          <p className="mt-2 text-3xl font-bold tracking-tight text-ink">{placement.organizations.length}</p>
          <p className="mt-1 text-xs text-ink-muted">Registered corporate cells</p>
        </div>

        <div className="rounded-[var(--radius-surface)] border border-line bg-surface p-5">
          <div className="flex items-center justify-between text-ink-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">Active Cohorts</span>
            <Briefcase className="size-4 text-brand" />
          </div>
          <p className="mt-2 text-3xl font-bold tracking-tight text-ink">
            {placement.organizations.reduce((acc, org) => acc + org.departments.length, 0)}
          </p>
          <p className="mt-1 text-xs text-ink-muted">Specialized placement streams</p>
        </div>

        <div className="rounded-[var(--radius-surface)] border border-line bg-surface p-5">
          <div className="flex items-center justify-between text-ink-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">Eligible Pool</span>
            <Users className="size-4 text-brand" />
          </div>
          <p className="mt-2 text-3xl font-bold tracking-tight text-ink">{students.length}</p>
          <p className="mt-1 text-xs text-ink-muted">Students registered in college</p>
        </div>

        <div className="rounded-[var(--radius-surface)] border border-line bg-surface p-5">
          <div className="flex items-center justify-between text-ink-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">Engineering Batches</span>
            <GraduationCap className="size-4 text-brand" />
          </div>
          <p className="mt-2 text-3xl font-bold tracking-tight text-ink">{batches.length}</p>
          <p className="mt-1 text-xs text-ink-muted">Graduating classes tracked</p>
        </div>
      </div>

      {/* Organizations & Cohorts listing */}
      <Section title="Placement Organizations & Specialized Training Units" description="Placement cells manage student groupings, drive eligibility, and corporate training programs.">
        {placement.organizations.length === 0 ? (
          <EmptyState>No placement organizations created yet. Add one in Departments.</EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {placement.organizations.map((org) => (
              <Panel key={org.id} className="p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-ink text-lg">{org.legal_name}</h3>
                    <p className="text-xs text-ink-muted font-mono">{org.code || "Active Cell"}</p>
                  </div>
                  <Badge tone="brand">Placement Org</Badge>
                </div>
                <div className="border-t border-line pt-3">
                  <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">Cohorts & Tracks</p>
                  {org.departments.length === 0 ? (
                    <p className="text-xs text-ink-muted italic">No department tracks assigned.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {org.departments.map((dept) => (
                        <span key={dept.id} className="inline-flex items-center gap-1.5 rounded-md bg-canvas/80 px-2.5 py-1 text-xs font-medium text-ink border border-line">
                          <CheckCircle2 className="size-3 text-brand" />
                          {dept.name} ({dept.code})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Panel>
            ))}
          </div>
        )}
      </Section>

      {/* Interactive Drives & Candidate Filter */}
      <Section title="Candidate Pool Eligibility Filter" description="Filter students by department, batch, and cohort readiness.">
        <PlacementsFilter students={students} departments={collegeDepts} batches={batches} />
      </Section>
    </div>
  );
}
